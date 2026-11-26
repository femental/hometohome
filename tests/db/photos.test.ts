import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/server/db";
import {
  MemoryPhotoStorage,
  SupabasePhotoStorage,
  type PhotoStorage,
} from "@/server/photos/storage";
import { randomUUID } from "node:crypto";
import {
  PHOTOS_PER_OWNER,
  PHOTO_MAX_BYTES,
  PHOTO_UPLOAD_MAX_BYTES,
  PhotoError,
  addPhoto,
  cleanupOrphanPhotos,
  createPhotoUpload,
  registerPhoto,
  removePhoto,
  reorderPhotos,
} from "@/server/photos/service";
import { makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

const jpeg = () => ({
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
  contentType: "image/jpeg",
});
const png = () => ({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  contentType: "image/png",
});
const webp = () => ({
  bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
  contentType: "image/webp",
});

async function setup() {
  const room = await makeRoom(prisma);
  return { room, owner: { kind: "room" as const, id: room.id }, storage: new MemoryPhotoStorage() };
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PhotoError);
    return (e as PhotoError).code;
  }
  throw new Error("expected PhotoError");
}

describe("addPhoto", () => {
  test("stores file and appends sort order", async () => {
    const { owner, storage } = await setup();
    const a = await addPhoto(prisma, storage, owner, jpeg());
    const b = await addPhoto(prisma, storage, owner, png());
    const c = await addPhoto(prisma, storage, owner, webp());
    expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([0, 1, 2]);
    expect(a.storagePath).toMatch(new RegExp(`^rooms/${owner.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(b.storagePath).toMatch(/\.png$/);
    expect(c.storagePath).toMatch(/\.webp$/);
    expect(storage.files.size).toBe(3);
    expect(storage.files.get(a.storagePath)?.contentType).toBe("image/jpeg");
  });

  test("works for a house owner", async () => {
    const { room, storage } = await setup();
    const p = await addPhoto(prisma, storage, { kind: "house", id: room.houseId }, jpeg());
    expect(p.storagePath.startsWith(`houses/${room.houseId}/`)).toBe(true);
    expect(await prisma.housePhoto.count()).toBe(1);
  });

  test("rejects gif, mismatched magic bytes and >4MiB before touching storage", async () => {
    const { owner, storage } = await setup();
    const gif = {
      bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      contentType: "image/gif",
    };
    expect(await codeOf(addPhoto(prisma, storage, owner, gif))).toBe("BAD_TYPE");
    expect(
      await codeOf(addPhoto(prisma, storage, owner, { ...png(), contentType: "image/jpeg" })),
    ).toBe("BAD_TYPE");
    const big = { bytes: new Uint8Array(PHOTO_MAX_BYTES + 1), contentType: "image/jpeg" };
    big.bytes.set([0xff, 0xd8, 0xff]);
    expect(await codeOf(addPhoto(prisma, storage, owner, big))).toBe("TOO_LARGE");
    expect(storage.files.size).toBe(0);
    expect(await prisma.roomPhoto.count()).toBe(0);
  });

  test("accepts a photo of exactly 4 MiB", async () => {
    const { owner, storage } = await setup();
    const exact = { bytes: new Uint8Array(PHOTO_MAX_BYTES), contentType: "image/jpeg" };
    exact.bytes.set([0xff, 0xd8, 0xff]);
    const p = await addPhoto(prisma, storage, owner, exact);
    expect(p.storagePath).toBeTruthy();
    expect(storage.files.size).toBe(1);
  });

  test("21st photo → LIMIT", async () => {
    const { room, owner, storage } = await setup();
    await prisma.roomPhoto.createMany({
      data: Array.from({ length: PHOTOS_PER_OWNER }, (_, i) => ({
        roomId: room.id,
        storagePath: `rooms/${room.id}/x${i}.jpg`,
        sortOrder: i,
      })),
    });
    expect(await codeOf(addPhoto(prisma, storage, owner, jpeg()))).toBe("LIMIT");
    expect(storage.files.size).toBe(0);
  });

  test("malformed or nonexistent owner → NOT_FOUND, nothing uploaded", async () => {
    const { storage } = await setup();
    for (const id of ["../x", "a/b", MISSING_ID]) {
      expect(await codeOf(addPhoto(prisma, storage, { kind: "room", id }, jpeg()))).toBe("NOT_FOUND");
      expect(await codeOf(addPhoto(prisma, storage, { kind: "house", id }, jpeg()))).toBe("NOT_FOUND");
    }
    expect(storage.files.size).toBe(0);
  });

  test("DB insert failure removes the uploaded file", async () => {
    const { room, owner, storage } = await setup();
    const db = {
      room: prisma.room,
      roomPhoto: {
        count: () => prisma.roomPhoto.count({ where: { roomId: room.id } }),
        aggregate: () => prisma.roomPhoto.aggregate({ _max: { sortOrder: true } }),
        create: async () => {
          throw new Error("db down");
        },
      },
    } as unknown as typeof prisma;
    await expect(addPhoto(db, storage, owner, jpeg())).rejects.toThrow("db down");
    expect(storage.files.size).toBe(0);
  });
});

describe("removePhoto", () => {
  test("deletes row and file", async () => {
    const { owner, storage } = await setup();
    const p = await addPhoto(prisma, storage, owner, jpeg());
    await removePhoto(prisma, storage, "room", p.id);
    expect(await prisma.roomPhoto.count()).toBe(0);
    expect(storage.files.size).toBe(0);
  });

  test("storage failure is logged, row stays deleted, no throw", async () => {
    const { owner, storage } = await setup();
    const p = await addPhoto(prisma, storage, owner, jpeg());
    const failing: PhotoStorage = Object.assign(Object.create(storage) as PhotoStorage, {
      remove: async () => {
        throw new Error("storage down");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await removePhoto(prisma, failing, "room", p.id);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(await prisma.roomPhoto.count()).toBe(0);
  });

  test("unknown id → NOT_FOUND", async () => {
    const { storage } = await setup();
    expect(await codeOf(removePhoto(prisma, storage, "house", MISSING_ID))).toBe("NOT_FOUND");
  });
});

describe("reorderPhotos", () => {
  test("applies order; mismatched id set → error, order unchanged", async () => {
    const { room, owner, storage } = await setup();
    const a = await addPhoto(prisma, storage, owner, jpeg());
    const b = await addPhoto(prisma, storage, owner, jpeg());
    const c = await addPhoto(prisma, storage, owner, jpeg());
    await reorderPhotos(prisma, "room", room.id, [c.id, a.id, b.id]);
    const order = async () =>
      (
        await prisma.roomPhoto.findMany({ where: { roomId: room.id }, orderBy: { sortOrder: "asc" } })
      ).map((p) => p.id);
    expect(await order()).toEqual([c.id, a.id, b.id]);

    for (const bad of [
      [a.id, b.id],
      [a.id, b.id, c.id, c.id],
      [a.id, b.id, a.id],
      [a.id, b.id, "nope"],
    ]) {
      expect(await codeOf(reorderPhotos(prisma, "room", room.id, bad))).toBe("NOT_FOUND");
    }
    expect(await order()).toEqual([c.id, a.id, b.id]);
  });
});

describe("SupabasePhotoStorage", () => {
  function fakeClient(missingBucketOnce = false) {
    let missing = missingBucketOnce;
    const upload = vi.fn(async () =>
      missing
        ? { data: null, error: { message: "Bucket not found", statusCode: "404" } }
        : { data: {}, error: null },
    );
    const createBucket = vi.fn(async () => {
      missing = false;
      return { data: {}, error: null };
    });
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const getPublicUrl = vi.fn((p: string) => ({ data: { publicUrl: `http://x/public/photos/${p}` } }));
    const client = { storage: { from: () => ({ upload, remove, getPublicUrl }), createBucket } };
    return { client: client as never, upload, createBucket };
  }

  test("put uses upsert false and long cache control", async () => {
    const f = fakeClient();
    const s = new SupabasePhotoStorage(f.client, "photos");
    await s.put("a/b.jpg", new Uint8Array([1]), "image/jpeg");
    expect(f.upload).toHaveBeenCalledWith("a/b.jpg", expect.any(Uint8Array), {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "31536000",
    });
    expect(s.publicUrl("a/b.jpg")).toBe("http://x/public/photos/a/b.jpg");
  });

  test("a missing bucket is a setup error: no bucket is created at runtime", async () => {
    const f = fakeClient(true);
    const s = new SupabasePhotoStorage(f.client, "photos");
    await expect(s.put("a.jpg", new Uint8Array([1]), "image/jpeg")).rejects.toBeTruthy();
    expect(f.createBucket).not.toHaveBeenCalled();
  });
});

describe("signed direct upload", () => {
  test("createPhotoUpload refuses bad type, >10MB and the 21st photo before issuing a URL", async () => {
    const { owner, storage } = await setup();
    expect(await codeOf(createPhotoUpload(prisma, storage, owner, { contentType: "image/gif", size: 10 }))).toBe("BAD_TYPE");
    expect(await codeOf(createPhotoUpload(prisma, storage, owner, { contentType: "image/jpeg", size: PHOTO_UPLOAD_MAX_BYTES + 1 }))).toBe(
      "TOO_LARGE",
    );
    for (let i = 0; i < PHOTOS_PER_OWNER; i++) {
      await prisma.roomPhoto.create({ data: { roomId: owner.id, storagePath: `rooms/${owner.id}/x${i}.jpg`, sortOrder: i } });
    }
    expect(await codeOf(createPhotoUpload(prisma, storage, owner, { contentType: "image/jpeg", size: 100 }))).toBe("LIMIT");
    expect(storage.signed).toHaveLength(0);
  });

  test("issues a server-chosen path under the owner and registers the uploaded file", async () => {
    const { owner, storage } = await setup();
    const up = await createPhotoUpload(prisma, storage, owner, { contentType: "image/png", size: 8 });
    expect(up.path).toMatch(new RegExp(`^rooms/${owner.id}/[0-9a-f-]{36}\\.png$`));
    await storage.put(up.path, png().bytes, "image/png"); // what the browser's direct upload does
    const photo = await registerPhoto(prisma, storage, owner, up.path);
    expect(photo.storagePath).toBe(up.path);
    // A double submit returns the same row instead of a second one for the same file.
    expect((await registerPhoto(prisma, storage, owner, up.path)).id).toBe(photo.id);
    expect(await prisma.roomPhoto.count()).toBe(1);
  });

  test("registerPhoto refuses a path outside the owner's prefix and a missing object", async () => {
    const { owner, storage } = await setup();
    const other = await makeRoom(prisma);
    await storage.put(`rooms/${other.id}/a.jpg`, jpeg().bytes, "image/jpeg");
    expect(await codeOf(registerPhoto(prisma, storage, owner, `rooms/${other.id}/a.jpg`))).toBe("NOT_FOUND");
    expect(await codeOf(registerPhoto(prisma, storage, owner, `rooms/${owner.id}/../${other.id}/a.jpg`))).toBe("NOT_FOUND");
    expect(await codeOf(registerPhoto(prisma, storage, owner, `rooms/${owner.id}/${randomUUID()}.jpg`))).toBe("NOT_FOUND");
    expect(await prisma.roomPhoto.count()).toBe(0);
  });

  test("registerPhoto rejects a file whose bytes are not an image and deletes it", async () => {
    const { owner, storage } = await setup();
    const up = await createPhotoUpload(prisma, storage, owner, { contentType: "image/jpeg", size: 8 });
    await storage.put(up.path, new TextEncoder().encode("<html>"), "image/jpeg");
    expect(await codeOf(registerPhoto(prisma, storage, owner, up.path))).toBe("BAD_TYPE");
    expect(storage.files.has(up.path)).toBe(false);
  });

  test("cleanup deletes unreferenced files older than 24h and keeps referenced or new ones", async () => {
    const { owner, storage } = await setup();
    const now = new Date();
    const old = new Date(now.getTime() - 25 * 3600_000);
    await storage.put(`rooms/${owner.id}/orphan.jpg`, jpeg().bytes, "image/jpeg", old);
    await storage.put(`rooms/${owner.id}/kept.jpg`, jpeg().bytes, "image/jpeg", old);
    await storage.put(`rooms/${owner.id}/fresh.jpg`, jpeg().bytes, "image/jpeg", now);
    await prisma.roomPhoto.create({ data: { roomId: owner.id, storagePath: `rooms/${owner.id}/kept.jpg`, sortOrder: 0 } });
    expect(await cleanupOrphanPhotos(prisma, storage, now)).toEqual({ deleted: 1 });
    expect([...storage.files.keys()].sort()).toEqual([`rooms/${owner.id}/fresh.jpg`, `rooms/${owner.id}/kept.jpg`]);
  });
});
