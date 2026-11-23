import "server-only";
import type { House, Host, Room, RoomBlock } from "@/generated/prisma/client";
import { effectiveStatus, OCCUPYING_STATUSES } from "@/domain/booking-status";
import { isValidISODate, type ISODate } from "@/domain/dates";
import { toDbDate } from "@/server/bookings/availability";
import type { Db } from "@/server/db";
import type { HouseInput, RoomInput } from "./schemas";

export type CatalogErrorCode = "NOT_FOUND" | "HAS_BOOKINGS" | "BLOCK_CONFLICT" | "INVALID";

export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CatalogError";
  }
}

export type PublishStatus = "draft" | "published" | "hidden";

/** Prisma's "record to update/delete not found" (P2025) becomes NOT_FOUND. */
async function orNotFound<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025") {
      throw new CatalogError("NOT_FOUND");
    }
    throw e;
  }
}

/** Runs `fn` atomically when given a full client; a transaction client already is one. */
function atomically<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction((tx) => fn(tx)) : fn(db);
}

const houseData = (input: HouseInput) => ({
  name: input.name,
  description: input.description,
  houseRules: input.houseRules,
  addressKo: input.addressKo,
  addressEn: input.addressEn || null,
  district: input.district,
  lat: input.lat,
  lng: input.lng,
  nearestStations: input.nearestStations,
  amenities: input.amenities,
});

const roomData = (input: RoomInput) => ({
  name: input.name,
  description: input.description,
  monthlyRent: input.monthlyRent,
  deposit: input.deposit,
  availableFrom: toDbDate(input.availableFrom),
  roomType: input.roomType,
  privateBathroom: input.privateBathroom,
  genderPolicy: input.genderPolicy,
  maxOccupants: input.maxOccupants,
  extraPersonMonthlyFee: input.extraPersonMonthlyFee,
});

export function createHouse(db: Db, hostId: string, input: HouseInput): Promise<House> {
  return db.house.create({ data: { hostId, ...houseData(input) } });
}

export function updateHouse(db: Db, houseId: string, input: HouseInput): Promise<House> {
  return orNotFound(() => db.house.update({ where: { id: houseId }, data: houseData(input) }));
}

export function setHouseStatus(db: Db, houseId: string, status: PublishStatus): Promise<House> {
  return orNotFound(() => db.house.update({ where: { id: houseId }, data: { status } }));
}

/** Deletes the house with its rooms, photos and blocks; refused if any room ever had a booking. */
export async function deleteHouse(db: Db, houseId: string): Promise<void> {
  await atomically(db, async (tx) => {
    const house = await tx.house.findUnique({ where: { id: houseId }, select: { id: true } });
    if (!house) throw new CatalogError("NOT_FOUND");
    const booked = await tx.booking.count({ where: { room: { houseId } } });
    if (booked > 0) throw new CatalogError("HAS_BOOKINGS");
    await tx.room.deleteMany({ where: { houseId } }); // room photos/blocks cascade
    await tx.house.delete({ where: { id: houseId } }); // house photos cascade
  });
}

export async function createRoom(db: Db, houseId: string, input: RoomInput): Promise<Room> {
  const house = await db.house.findUnique({ where: { id: houseId }, select: { id: true } });
  if (!house) throw new CatalogError("NOT_FOUND");
  return db.room.create({ data: { houseId, ...roomData(input) } });
}

/** Booking rows keep their own price snapshot, so this never touches them. */
export function updateRoom(db: Db, roomId: string, input: RoomInput): Promise<Room> {
  return orNotFound(() => db.room.update({ where: { id: roomId }, data: roomData(input) }));
}

export function setRoomStatus(db: Db, roomId: string, status: PublishStatus): Promise<Room> {
  return orNotFound(() => db.room.update({ where: { id: roomId }, data: { status } }));
}

export async function deleteRoom(db: Db, roomId: string): Promise<void> {
  await atomically(db, async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) throw new CatalogError("NOT_FOUND");
    const booked = await tx.booking.count({ where: { roomId } });
    if (booked > 0) throw new CatalogError("HAS_BOOKINGS");
    await tx.room.delete({ where: { id: roomId } }); // photos/blocks cascade
  });
}

/**
 * Blocks `[startDate, endDateExclusive)`. Conflicts with bookings that still occupy the
 * room at `now` (same overlap rule as isRoomFree; expired holds and requests do not).
 */
export async function createBlock(
  db: Db,
  roomId: string,
  input: { startDate: ISODate; endDateExclusive: ISODate; reason: string },
  now: Date,
): Promise<RoomBlock> {
  const { startDate, endDateExclusive, reason } = input;
  if (!isValidISODate(startDate) || !isValidISODate(endDateExclusive) || endDateExclusive <= startDate) {
    throw new CatalogError("INVALID", "종료일은 시작일보다 늦어야 합니다.");
  }
  const start = toDbDate(startDate);
  const end = toDbDate(endDateExclusive);

  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) throw new CatalogError("NOT_FOUND");

  const overlapping = await db.booking.findMany({
    where: {
      roomId,
      status: { in: [...OCCUPYING_STATUSES] },
      moveIn: { lt: end },
      moveOut: { gt: start },
    },
    select: { status: true, requestExpiresAt: true, holdExpiresAt: true },
  });
  if (overlapping.some((b) => OCCUPYING_STATUSES.includes(effectiveStatus(b, now)))) {
    throw new CatalogError("BLOCK_CONFLICT");
  }
  return db.roomBlock.create({
    data: { roomId, startDate: start, endDateExclusive: end, reason },
  });
}

export async function deleteBlock(db: Db, blockId: string): Promise<void> {
  await orNotFound(() => db.roomBlock.delete({ where: { id: blockId } }));
}

/** The operator's Host row; created on first use with the user's email as display name. */
export async function getAdminHost(db: Db, userId: string): Promise<Host> {
  const existing = await db.host.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new CatalogError("NOT_FOUND");
  return db.host.create({ data: { userId, displayName: user.email } });
}

export function listHousesForAdmin(db: Db): Promise<(House & { rooms: Room[] })[]> {
  return db.house.findMany({
    include: { rooms: { orderBy: { id: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

