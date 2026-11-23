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
