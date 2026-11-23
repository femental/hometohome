import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Amenity } from "@/domain/amenities";
import { addDays, isValidISODate, type ISODate } from "@/domain/dates";
import { photoUrl } from "@/lib/photo-url";
import { fromDbDate, isRoomFree } from "@/server/bookings/availability";
import type { Db } from "@/server/db";
import type { LocalizedText } from "@/server/rooms/search";

export type Station = { name_en: string; name_ko?: string; line?: string; walk_min?: number };

export interface PublicPhoto {
  url: string;
  alt: string;
}

export interface PublicRoomSummary {
  id: string;
  name: LocalizedText;
  monthlyRent: number;
  deposit: number;
  availableFrom: ISODate;
  roomType: string;
  genderPolicy: string;
  privateBathroom: boolean;
  maxOccupants: number;
  extraPersonMonthlyFee: number;
  coverPhotoUrl: string | null;
  available?: boolean;
}

export interface PublicHouse {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  houseRules: LocalizedText;
  district: string;
  addressKo: string;
  lat: number;
  lng: number;
  amenities: Amenity[];
  nearestStations: Station[];
  photos: PublicPhoto[];
  rooms: PublicRoomSummary[];
}

export interface PublicRoom extends PublicRoomSummary {
  description: LocalizedText;
  photos: PublicPhoto[];
  house: Omit<PublicHouse, "rooms">;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const byOrder = { orderBy: { sortOrder: "asc" } } as const;

const houseSelect = {
  id: true,
  name: true,
  description: true,
  houseRules: true,
  district: true,
  addressKo: true,
  lat: true,
  lng: true,
  amenities: true,
  nearestStations: true,
  photos: byOrder,
} satisfies Prisma.HouseSelect;

const roomSelect = {
  id: true,
  name: true,
  description: true,
  monthlyRent: true,
  deposit: true,
  availableFrom: true,
  roomType: true,
  genderPolicy: true,
  privateBathroom: true,
  maxOccupants: true,
  extraPersonMonthlyFee: true,
  photos: byOrder,
} satisfies Prisma.RoomSelect;

type HouseRow = Prisma.HouseGetPayload<{ select: typeof houseSelect }>;
type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomSelect }>;

const toPhotos = (rows: { storagePath: string }[], alt: string): PublicPhoto[] =>
  rows.map((p) => ({ url: photoUrl(p.storagePath), alt }));

function toHouse(row: HouseRow): Omit<PublicHouse, "rooms"> {
  const name = row.name as LocalizedText;
  return {
    id: row.id,
    name,
    description: row.description as LocalizedText,
    houseRules: row.houseRules as LocalizedText,
    district: row.district,
    addressKo: row.addressKo,
    lat: row.lat,
    lng: row.lng,
    amenities: row.amenities as Amenity[],
    nearestStations: (Array.isArray(row.nearestStations) ? row.nearestStations : []) as Station[],
    photos: toPhotos(row.photos, name.en),
  };
}

function toRoomSummary(row: RoomRow): PublicRoomSummary {
  return {
    id: row.id,
    name: row.name as LocalizedText,
    monthlyRent: row.monthlyRent,
    deposit: row.deposit,
    availableFrom: fromDbDate(row.availableFrom),
    roomType: row.roomType,
    genderPolicy: row.genderPolicy,
    privateBathroom: row.privateBathroom,
    maxOccupants: row.maxOccupants,
    extraPersonMonthlyFee: row.extraPersonMonthlyFee,
    coverPhotoUrl: row.photos[0] ? photoUrl(row.photos[0].storagePath) : null,
  };
}

export async function getPublicHouse(
  db: Db,
  id: string,
  opts: { moveIn?: ISODate; lastNight?: ISODate; now: Date },
): Promise<PublicHouse | null> {
  if (!UUID_RE.test(id)) return null;
  const row = await db.house.findFirst({
    where: { id, status: "published" },
    select: {
      ...houseSelect,
      rooms: {
        where: { status: "published" },
        orderBy: [{ monthlyRent: "asc" }, { id: "asc" }],
        select: roomSelect,
      },
    },
  });
  if (!row) return null;

  const { moveIn, lastNight } = opts;
  const range =
    moveIn && lastNight && isValidISODate(moveIn) && isValidISODate(lastNight) && lastNight >= moveIn
      ? { moveIn, moveOut: addDays(lastNight, 1) }
      : null;

  const rooms = await Promise.all(
    row.rooms.map(async (r) => {
      const summary = toRoomSummary(r);
      if (!range) return summary;
      const available =
        summary.availableFrom <= range.moveIn &&
        (await isRoomFree(db, r.id, range.moveIn, range.moveOut, opts.now));
      return { ...summary, available };
    }),
  );
  return { ...toHouse(row), rooms };
}

export async function getPublicRoom(db: Db, id: string): Promise<PublicRoom | null> {
  if (!UUID_RE.test(id)) return null;
  const row = await db.room.findFirst({
    where: { id, status: "published", house: { status: "published" } },
    select: { ...roomSelect, house: { select: houseSelect } },
  });
  if (!row) return null;
  const name = row.name as LocalizedText;
  return {
    ...toRoomSummary(row),
    description: row.description as LocalizedText,
    photos: toPhotos(row.photos, name.en),
    house: toHouse(row.house),
  };
}
