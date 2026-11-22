import { Prisma } from "@/generated/prisma/client";
import { addDays, type ISODate } from "@/domain/dates";
import type { Db } from "@/server/db";
import { fromDbDate } from "@/server/bookings/availability";

export type LocalizedText = { en: string; ko?: string };

export interface RoomSearchParams {
  moveIn?: ISODate;
  lastNight?: ISODate;
  minRent?: number;
  maxRent?: number;
  districts?: string[];
  roomType?: "single" | "double";
  genderPolicy?: "male" | "female" | "any";
  occupants?: 1 | 2;
}

export interface RoomSearchResult {
  roomId: string;
  houseId: string;
  roomName: LocalizedText;
  houseName: LocalizedText;
  district: string;
  lat: number;
  lng: number;
  monthlyRent: number;
  deposit: number;
  availableFrom: ISODate;
  roomType: "single" | "double";
  genderPolicy: "male" | "female" | "any";
  privateBathroom: boolean;
  coverPhotoPath: string | null;
}

interface Row {
  room_id: string;
  house_id: string;
  room_name: LocalizedText;
  house_name: LocalizedText;
  district: string;
  lat: number;
  lng: number;
  monthly_rent: number;
  deposit: number;
  available_from: Date;
  room_type: "single" | "double";
  gender_policy: "male" | "female" | "any";
  private_bathroom: boolean;
  cover_photo_path: string | null;
}

/**
 * Published rooms of published houses, cheapest first. When a stay range is given, rooms
 * must be available from `moveIn` and free over `[moveIn, lastNight + 1)`; the occupancy
 * rule mirrors `isRoomFree` (blocks, confirmed, and awaiting_payment with an unexpired hold).
 */
export async function searchRooms(
  db: Db,
  p: RoomSearchParams,
  now: Date,
): Promise<RoomSearchResult[]> {
  if ((p.moveIn === undefined) !== (p.lastNight === undefined)) {
    throw new Error("searchRooms: moveIn and lastNight must be given together");
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`r.status = 'published'`,
    Prisma.sql`h.status = 'published'`,
  ];

  if (p.moveIn !== undefined && p.lastNight !== undefined) {
    if (p.lastNight < p.moveIn) throw new Error("searchRooms: lastNight is before moveIn");
    const moveIn = p.moveIn;
    const moveOut = addDays(p.lastNight, 1);
    conditions.push(
      Prisma.sql`r.available_from <= ${moveIn}::date`,
      Prisma.sql`NOT EXISTS (
        SELECT 1 FROM room_blocks rb
        WHERE rb.room_id = r.id
          AND rb.start_date < ${moveOut}::date
          AND rb.end_date_exclusive > ${moveIn}::date
      )`,
      Prisma.sql`NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.room_id = r.id
          AND b.move_in < ${moveOut}::date
          AND b.move_out > ${moveIn}::date
          AND (
            b.status = 'confirmed'
            OR (b.status = 'awaiting_payment'
                AND (b.hold_expires_at IS NULL OR b.hold_expires_at > ${now}::timestamptz))
          )
      )`,
    );
  }

  if (p.minRent !== undefined) conditions.push(Prisma.sql`r.monthly_rent >= ${p.minRent}`);
  if (p.maxRent !== undefined) conditions.push(Prisma.sql`r.monthly_rent <= ${p.maxRent}`);
  if (p.districts && p.districts.length > 0) {
    conditions.push(Prisma.sql`h.district IN (${Prisma.join(p.districts)})`);
  }
  if (p.roomType) conditions.push(Prisma.sql`r.room_type = ${p.roomType}::"RoomType"`);
  if (p.genderPolicy) {
    conditions.push(Prisma.sql`r.gender_policy = ${p.genderPolicy}::"GenderPolicy"`);
  }
  if (p.occupants === 2) conditions.push(Prisma.sql`r.max_occupants >= 2`);

  const rows = await db.$queryRaw<Row[]>`
    SELECT
      r.id AS room_id,
      h.id AS house_id,
      r.name AS room_name,
      h.name AS house_name,
      h.district,
      h.lat,
      h.lng,
      r.monthly_rent,
      r.deposit,
      r.available_from,
      r.room_type,
      r.gender_policy,
      r.private_bathroom,
      COALESCE(
        (SELECT rp.storage_path FROM room_photos rp
          WHERE rp.room_id = r.id ORDER BY rp.sort_order, rp.id LIMIT 1),
        (SELECT hp.storage_path FROM house_photos hp
          WHERE hp.house_id = h.id ORDER BY hp.sort_order, hp.id LIMIT 1)
      ) AS cover_photo_path
    FROM rooms r
    JOIN houses h ON h.id = r.house_id
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY r.monthly_rent ASC, r.id ASC
  `;

  return rows.map((row) => ({
    roomId: row.room_id,
    houseId: row.house_id,
    roomName: row.room_name,
    houseName: row.house_name,
    district: row.district,
    lat: Number(row.lat),
    lng: Number(row.lng),
    monthlyRent: Number(row.monthly_rent),
    deposit: Number(row.deposit),
    availableFrom: fromDbDate(row.available_from),
    roomType: row.room_type,
    genderPolicy: row.gender_policy,
    privateBathroom: row.private_bathroom,
    coverPhotoPath: row.cover_photo_path,
  }));
}
