import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { BookingStatus } from "@/domain/booking-status";
import type { ISODate } from "@/domain/dates";
import { calculatePrice } from "@/domain/pricing";
import { prisma, type Db } from "@/server/db";

const toDate = (iso: ISODate) => new Date(`${iso}T00:00:00Z`);

const TABLES = [
  "email_log",
  "refunds",
  "payments",
  "bookings",
  "room_blocks",
  "room_photos",
  "rooms",
  "house_photos",
  "houses",
  "hosts",
  "users",
];

export async function resetDb(db: Db = prisma) {
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export function makeAdmin(db: Db, overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return db.user.create({
    data: { id, email: `admin-${id}@example.com`, name: "Admin", role: "admin", ...overrides },
  });
}

export function makeGuest(db: Db, overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return db.user.create({
    data: { id, email: `guest-${id}@example.com`, name: "Guest", role: "guest", ...overrides },
  });
}

type RoomOverrides = Partial<
  Omit<Prisma.RoomUncheckedCreateInput, "availableFrom"> & { availableFrom: ISODate }
>;

export async function makeRoom(db: Db, overrides: RoomOverrides = {}) {
  const { availableFrom, houseId, ...rest } = overrides;
  let resolvedHouseId = houseId;
  if (!resolvedHouseId) {
    const admin = await makeAdmin(db);
    const host = await db.host.create({ data: { userId: admin.id, displayName: "Host" } });
    const house = await db.house.create({
      data: {
        hostId: host.id,
        status: "published",
        name: { en: "Test House" },
        description: { en: "A test house" },
        houseRules: { en: "No parties" },
        addressKo: "서울특별시 마포구 와우산로 1",
        district: "mapo",
        lat: 37.55,
        lng: 126.92,
      },
    });
    resolvedHouseId = house.id;
  }
  return db.room.create({
    data: {
      houseId: resolvedHouseId,
      status: "published",
      name: { en: "Room 101" },
      description: { en: "A test room" },
      monthlyRent: 800_000,
      deposit: 500_000,
      roomType: "single",
      genderPolicy: "any",
      maxOccupants: 1,
      ...rest,
      availableFrom: toDate(availableFrom ?? "2027-01-01"),
    },
  });
}

type BookingOverrides = Partial<
  Omit<Prisma.BookingUncheckedCreateInput, "roomId" | "moveIn" | "moveOut" | "status">
> & {
  roomId: string;
  moveIn: ISODate;
  moveOut: ISODate;
  status: BookingStatus;
};

export async function makeBooking(db: Db, overrides: BookingOverrides) {
  const { moveIn, moveOut, guestId, ...rest } = overrides;
  const resolvedGuestId = guestId ?? (await makeGuest(db)).id;
  const occupants = (rest.occupants ?? 1) as 1 | 2;
  const quote = calculatePrice({
    monthlyRent: 800_000,
    extraPersonMonthlyFee: 0,
    deposit: 500_000,
    moveIn,
    moveOut,
    occupants,
  });
  return db.booking.create({
    data: {
      guestId: resolvedGuestId,
      guestName: "Test Guest",
      nationality: "US",
      gender: "male",
      occupants,
      monthlyRent: quote.appliedMonthlyRent,
      deposit: quote.deposit,
      fullMonths: quote.fullMonths,
      extraDays: quote.extraDays,
      proratedAmount: quote.proratedAmount,
      stayTotal: quote.stayTotal,
      firstRentAmount: quote.firstRentAmount,
      firstPaymentTotal: quote.firstPaymentTotal,
      ...rest,
      moveIn: toDate(moveIn),
      moveOut: toDate(moveOut),
    },
  });
}
