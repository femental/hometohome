import "server-only";
import { randomUUID } from "node:crypto";
import type { HousePhoto, RoomPhoto } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { PhotoStorage } from "./storage";

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTOS_PER_OWNER = 20;

export type PhotoErrorCode = "BAD_TYPE" | "TOO_LARGE" | "NOT_FOUND" | "LIMIT";

export class PhotoError extends Error {
  constructor(public readonly code: PhotoErrorCode) {
    super(code);
    this.name = "PhotoError";
  }
}

export type PhotoOwnerKind = "house" | "room";
export type PhotoOwner = { kind: PhotoOwnerKind; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

function startsWith(bytes: Uint8Array, sig: number[], offset = 0) {
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Type from magic bytes, or null when not a supported image. */
function sniff(bytes: Uint8Array): (typeof PHOTO_TYPES)[number] | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

/** Thin per-kind adapter so the logic below is written once. */
function repo(db: Db, kind: PhotoOwnerKind) {
  if (kind === "house") {
    return {
      list: (ownerId: string) =>
        db.housePhoto.findMany({ where: { houseId: ownerId }, select: { id: true } }),
      count: (ownerId: string) => db.housePhoto.count({ where: { houseId: ownerId } }),
      maxSort: async (ownerId: string) =>
        (await db.housePhoto.aggregate({ where: { houseId: ownerId }, _max: { sortOrder: true } }))._max
          .sortOrder,
      create: (ownerId: string, storagePath: string, sortOrder: number): Promise<HousePhoto> =>
        db.housePhoto.create({ data: { houseId: ownerId, storagePath, sortOrder } }),
      ownerExists: async (ownerId: string) =>
        (await db.house.count({ where: { id: ownerId } })) > 0,
      find: (id: string) => db.housePhoto.findUnique({ where: { id } }),
      findByPath: (ownerId: string, storagePath: string) =>
        db.housePhoto.findFirst({ where: { houseId: ownerId, storagePath } }),
      delete: (id: string) => db.housePhoto.delete({ where: { id } }),
      setSort: (id: string, sortOrder: number) =>
        db.housePhoto.update({ where: { id }, data: { sortOrder } }),
    };
  }
  return {
    list: (ownerId: string) =>
      db.roomPhoto.findMany({ where: { roomId: ownerId }, select: { id: true } }),
    count: (ownerId: string) => db.roomPhoto.count({ where: { roomId: ownerId } }),
    maxSort: async (ownerId: string) =>
      (await db.roomPhoto.aggregate({ where: { roomId: ownerId }, _max: { sortOrder: true } }))._max
        .sortOrder,
    create: (ownerId: string, storagePath: string, sortOrder: number): Promise<RoomPhoto> =>
      db.roomPhoto.create({ data: { roomId: ownerId, storagePath, sortOrder } }),
    ownerExists: async (ownerId: string) =>
      (await db.room.count({ where: { id: ownerId } })) > 0,
    find: (id: string) => db.roomPhoto.findUnique({ where: { id } }),
    findByPath: (ownerId: string, storagePath: string) =>
      db.roomPhoto.findFirst({ where: { roomId: ownerId, storagePath } }),
    delete: (id: string) => db.roomPhoto.delete({ where: { id } }),
    setSort: (id: string, sortOrder: number) =>
      db.roomPhoto.update({ where: { id }, data: { sortOrder } }),
  };
}

export async function addPhoto(
  db: Db,
  storage: PhotoStorage,
  owner: PhotoOwner,
  file: { bytes: Uint8Array; contentType: string },
): Promise<HousePhoto | RoomPhoto> {
  // All validation happens before any storage call.
  const detected = sniff(file.bytes);
  if (!detected || detected !== file.contentType) throw new PhotoError("BAD_TYPE");
  if (file.bytes.length > PHOTO_MAX_BYTES) throw new PhotoError("TOO_LARGE");

  // Owner id ends up in the storage key: require a UUID and an existing owner first.
  if (!UUID_RE.test(owner.id)) throw new PhotoError("NOT_FOUND");
  const r = repo(db, owner.kind);
  if (!(await r.ownerExists(owner.id))) throw new PhotoError("NOT_FOUND");
  if ((await r.count(owner.id)) >= PHOTOS_PER_OWNER) throw new PhotoError("LIMIT");
  const sortOrder = ((await r.maxSort(owner.id)) ?? -1) + 1;

  const path = `${owner.kind}s/${owner.id}/${randomUUID()}.${EXT[detected]}`;
  await storage.put(path, file.bytes, detected);
  try {
    return await r.create(owner.id, path, sortOrder);
  } catch (e) {
    await storage.remove([path]).catch((err) => console.error("photo cleanup failed", path, err));
    throw e;
  }
}

/** Direct (signed) uploads skip the server action body limit, so they may be larger. */
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const FILE_NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;

/**
 * Step 1 of a direct upload: checks type, size and the per-owner limit, then issues a signed
 * upload URL for a server-chosen path under the owner (`houses|rooms/<ownerId>/<uuid>.<ext>`).
 */
export async function createPhotoUpload(
  db: Db,
  storage: PhotoStorage,
  owner: PhotoOwner,
  file: { contentType: string; size: number },
): Promise<{ path: string; signedUrl: string; token: string }> {
  const type = PHOTO_TYPES.find((t) => t === file.contentType);
  if (!type) throw new PhotoError("BAD_TYPE");
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > PHOTO_UPLOAD_MAX_BYTES) throw new PhotoError("TOO_LARGE");
  if (!UUID_RE.test(owner.id)) throw new PhotoError("NOT_FOUND");
  const r = repo(db, owner.kind);
  if (!(await r.ownerExists(owner.id))) throw new PhotoError("NOT_FOUND");
  if ((await r.count(owner.id)) >= PHOTOS_PER_OWNER) throw new PhotoError("LIMIT");

  const path = `${owner.kind}s/${owner.id}/${randomUUID()}.${EXT[type]}`;
  return { path, ...(await storage.signedUpload(path)) };
}

/**
 * Step 2: after the browser uploaded to the signed URL, checks the object really is an image of the
 * kind its name says and within the size limit, then creates the photo row. A bad file is deleted.
 */
export async function registerPhoto(
  db: Db,
  storage: PhotoStorage,
  owner: PhotoOwner,
  path: string,
): Promise<HousePhoto | RoomPhoto> {
  if (!UUID_RE.test(owner.id)) throw new PhotoError("NOT_FOUND");
  const prefix = `${owner.kind}s/${owner.id}/`;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (!FILE_NAME_RE.test(name)) throw new PhotoError("NOT_FOUND");
  const r = repo(db, owner.kind);
  if (!(await r.ownerExists(owner.id))) throw new PhotoError("NOT_FOUND");
  // A double submit or a retry after a lost response: the row already exists.
  const existing = await r.findByPath(owner.id, path);
  if (existing) return existing;

  const bytes = await storage.read(path);
  if (!bytes) throw new PhotoError("NOT_FOUND");
  const detected = sniff(bytes);
  const expected = PHOTO_TYPES.find((t) => EXT[t] === name.split(".")[1].toLowerCase());
  const problem: PhotoErrorCode | null =
    !detected || detected !== expected ? "BAD_TYPE" : bytes.length > PHOTO_UPLOAD_MAX_BYTES ? "TOO_LARGE" : null;
  if (problem) {
    await storage.remove([path]).catch((err) => console.error("photo cleanup failed", path, err));
    throw new PhotoError(problem);
  }
  if ((await r.count(owner.id)) >= PHOTOS_PER_OWNER) {
    await storage.remove([path]).catch((err) => console.error("photo cleanup failed", path, err));
    throw new PhotoError("LIMIT");
  }
  const sortOrder = ((await r.maxSort(owner.id)) ?? -1) + 1;
  return r.create(owner.id, path, sortOrder);
}

const ORPHAN_AGE_MS = 24 * 3600_000;
const ORPHAN_BATCH = 500;

/**
 * Daily: deletes stored photo files no photo row points to, once they are a day old (a fresh file
 * may belong to an upload that is about to be registered). At most 500 files per run.
 */
export async function cleanupOrphanPhotos(db: Db, storage: PhotoStorage, now: Date): Promise<{ deleted: number }> {
  const cutoff = now.getTime() - ORPHAN_AGE_MS;
  const orphans: string[] = [];
  for (const root of ["houses", "rooms"]) {
    for (const folder of await storage.listFolders(root)) {
      const files = (await storage.list(folder)).filter((f) => f.createdAt.getTime() < cutoff);
      if (files.length === 0) continue;
      const paths = files.map((f) => f.path);
      const [h, rm] = await Promise.all([
        db.housePhoto.findMany({ where: { storagePath: { in: paths } }, select: { storagePath: true } }),
        db.roomPhoto.findMany({ where: { storagePath: { in: paths } }, select: { storagePath: true } }),
      ]);
      const used = new Set([...h, ...rm].map((p) => p.storagePath));
      orphans.push(...paths.filter((p) => !used.has(p)));
      if (orphans.length >= ORPHAN_BATCH) break;
    }
  }
  const batch = orphans.slice(0, ORPHAN_BATCH);
  if (batch.length > 0) await storage.remove(batch);
  return { deleted: batch.length };
}

export async function removePhoto(
  db: Db,
  storage: PhotoStorage,
  kind: PhotoOwnerKind,
  photoId: string,
): Promise<void> {
  const r = repo(db, kind);
  const photo = await r.find(photoId);
  if (!photo) throw new PhotoError("NOT_FOUND");
  // Row first: an orphaned file is acceptable, a dangling row is not.
  await r.delete(photoId);
  try {
    await storage.remove([photo.storagePath]);
  } catch (err) {
    console.error("photo storage removal failed", photo.storagePath, err);
  }
}

export async function reorderPhotos(
  db: Db,
  kind: PhotoOwnerKind,
  ownerId: string,
  orderedIds: string[],
): Promise<void> {
  const run = async (tx: Db) => {
    const r = repo(tx, kind);
    const existing = new Set((await r.list(ownerId)).map((p) => p.id));
    const given = new Set(orderedIds);
    if (
      given.size !== orderedIds.length ||
      given.size !== existing.size ||
      orderedIds.some((id) => !existing.has(id))
    ) {
      throw new PhotoError("NOT_FOUND");
    }
    for (const [i, id] of orderedIds.entries()) await r.setSort(id, i);
  };
  if ("$transaction" in db) await db.$transaction((tx) => run(tx));
  else await run(db);
}
