import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import {
  CatalogError,
  createBlock,
  createHouse,
  createRoom,
  deleteBlock,
  deleteHouse,
  deleteRoom,
  getAdminHost,
  listHousesForAdmin,
  setHouseStatus,
  updateHouse,
  updateRoom,
} from "@/server/admin/catalog";
import { houseInput, roomInput } from "@/server/admin/schemas";
import { makeAdmin, makeBooking, makeRoom, resetDb } from "./factories";

const now = new Date("2027-01-01T00:00:00Z");

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const houseIn = houseInput.parse({
  name: { en: "Mapo House", ko: "마포 하우스" },
  description: { en: "Nice", ko: "좋음" },
  houseRules: { en: "Quiet" },
  addressKo: "서울 마포구 와우산로 1",
  addressEn: "1 Wausan-ro, Mapo-gu",
  district: "mapo",
  lat: 37.55,
  lng: 126.92,
  nearestStations: [{ name_en: "Hongik Univ.", name_ko: "홍대입구", line: "2", walk_min: 5 }],
  amenities: ["wifi", "kitchen"],
});
const roomIn = roomInput.parse({
  name: { en: "101", ko: "101호" },
  description: { en: "Cozy" },
  monthlyRent: 800_000,
  deposit: 500_000,
  availableFrom: "2027-02-01",
  roomType: "double",
  privateBathroom: true,
  genderPolicy: "female",
  extraPersonMonthlyFee: 100_000,
});

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return (e as CatalogError).code;
  }
  return null;
}

describe("house and room CRUD", () => {
  test("create/update house and room roundtrip with multilingual fields", async () => {
    const admin = await makeAdmin(prisma);
    const host = await getAdminHost(prisma, admin.id);
    const house = await createHouse(prisma, host.id, houseIn);
    expect(house.status).toBe("draft");
    expect(house.name).toEqual({ en: "Mapo House", ko: "마포 하우스" });
    expect(house.nearestStations).toEqual(houseIn.nearestStations);
    expect(house.amenities).toEqual(["wifi", "kitchen"]);

    const updated = await updateHouse(prisma, house.id, { ...houseIn, name: { en: "Renamed" }, district: "jung" });
    expect(updated.name).toEqual({ en: "Renamed" });
    expect(updated.district).toBe("jung");
    expect((await setHouseStatus(prisma, house.id, "published")).status).toBe("published");

    const room = await createRoom(prisma, house.id, roomIn);
    expect(room).toMatchObject({ roomType: "double", maxOccupants: 2, extraPersonMonthlyFee: 100_000, genderPolicy: "female" });
    expect(room.availableFrom.toISOString().slice(0, 10)).toBe("2027-02-01");
    expect(room.name).toEqual({ en: "101", ko: "101호" });

    const single = await updateRoom(prisma, room.id, roomInput.parse({ ...roomIn, roomType: "single" }));
    expect(single).toMatchObject({ maxOccupants: 1, extraPersonMonthlyFee: 0 });

    const list = await listHousesForAdmin(prisma);
    expect(list).toHaveLength(1);
    expect(list[0].rooms.map((r) => r.id)).toEqual([room.id]);
  });

  test("unknown ids raise NOT_FOUND", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await codeOf(updateHouse(prisma, missing, houseIn))).toBe("NOT_FOUND");
    expect(await codeOf(createRoom(prisma, missing, roomIn))).toBe("NOT_FOUND");
    expect(await codeOf(deleteRoom(prisma, missing))).toBe("NOT_FOUND");
    expect(await codeOf(deleteHouse(prisma, missing))).toBe("NOT_FOUND");
    expect(await codeOf(deleteBlock(prisma, missing))).toBe("NOT_FOUND");
  });

  test("deleteRoom with any booking → HAS_BOOKINGS; without → deleted", async () => {
    const booked = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: booked.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "rejected" });
    expect(await codeOf(deleteRoom(prisma, booked.id))).toBe("HAS_BOOKINGS");
    expect(await prisma.room.count({ where: { id: booked.id } })).toBe(1);

    const free = await makeRoom(prisma);
    await prisma.roomBlock.create({
      data: { roomId: free.id, startDate: new Date("2027-02-01T00:00:00Z"), endDateExclusive: new Date("2027-02-05T00:00:00Z") },
    });
    await deleteRoom(prisma, free.id);
    expect(await prisma.room.count({ where: { id: free.id } })).toBe(0);
    expect(await prisma.roomBlock.count({ where: { roomId: free.id } })).toBe(0);
  });

  test("deleteHouse with a booked room → HAS_BOOKINGS; otherwise cascades", async () => {
    const booked = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: booked.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "cancelled" });
    expect(await codeOf(deleteHouse(prisma, booked.houseId))).toBe("HAS_BOOKINGS");
    expect(await prisma.house.count({ where: { id: booked.houseId } })).toBe(1);
    expect(await prisma.room.count({ where: { id: booked.id } })).toBe(1);

    const room = await makeRoom(prisma);
    await prisma.housePhoto.create({ data: { houseId: room.houseId, storagePath: "a.jpg" } });
    await prisma.roomPhoto.create({ data: { roomId: room.id, storagePath: "b.jpg" } });
    await deleteHouse(prisma, room.houseId);
    expect(await prisma.house.count({ where: { id: room.houseId } })).toBe(0);
    expect(await prisma.room.count({ where: { id: room.id } })).toBe(0);
    expect(await prisma.housePhoto.count({ where: { houseId: room.houseId } })).toBe(0);
    expect(await prisma.roomPhoto.count({ where: { roomId: room.id } })).toBe(0);
  });
});

describe("createBlock", () => {
  const block = (start: string, end: string) => ({ startDate: start, endDateExclusive: end, reason: "repair" });

  test("overlapping confirmed booking → BLOCK_CONFLICT", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "confirmed" });
    expect(await codeOf(createBlock(prisma, room.id, block("2027-02-20", "2027-03-05"), now))).toBe("BLOCK_CONFLICT");
    await makeBooking(prisma, {
      roomId: room.id, moveIn: "2027-04-01", moveOut: "2027-05-01", status: "awaiting_payment",
      holdExpiresAt: new Date("2027-01-02T00:00:00Z"),
    });
    expect(await codeOf(createBlock(prisma, room.id, block("2027-04-10", "2027-04-12"), now))).toBe("BLOCK_CONFLICT");
    expect(await prisma.roomBlock.count()).toBe(0);
  });

  test("overlapping only an expired hold or requested booking → allowed", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, {
      roomId: room.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "awaiting_payment",
      holdExpiresAt: new Date("2026-12-31T00:00:00Z"),
    });
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-01", moveOut: "2027-04-01", status: "requested" });
    const b = await createBlock(prisma, room.id, block("2027-02-10", "2027-03-20"), now);
    expect(b.startDate.toISOString().slice(0, 10)).toBe("2027-02-10");
    expect(b.reason).toBe("repair");
  });

  test("adjacent to confirmed booking → allowed", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "confirmed" });
    await createBlock(prisma, room.id, block("2027-03-01", "2027-03-10"), now);
    await createBlock(prisma, room.id, block("2027-01-20", "2027-02-01"), now);
    expect(await prisma.roomBlock.count({ where: { roomId: room.id } })).toBe(2);
  });

  test("end <= start → INVALID", async () => {
    const room = await makeRoom(prisma);
    expect(await codeOf(createBlock(prisma, room.id, block("2027-02-10", "2027-02-10"), now))).toBe("INVALID");
    expect(await codeOf(createBlock(prisma, room.id, block("2027-02-10", "2027-02-01"), now))).toBe("INVALID");
  });

  test("deleteBlock removes it", async () => {
    const room = await makeRoom(prisma);
    const b = await createBlock(prisma, room.id, block("2027-02-10", "2027-02-12"), now);
    await deleteBlock(prisma, b.id);
    expect(await prisma.roomBlock.count()).toBe(0);
  });
});

describe("price snapshot and admin host", () => {
  test("updateRoom price does not change existing booking snapshot", async () => {
    const room = await makeRoom(prisma);
    const booking = await makeBooking(prisma, { roomId: room.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "confirmed" });
    await updateRoom(prisma, room.id, roomInput.parse({ ...roomIn, roomType: "single", monthlyRent: 1_200_000, deposit: 900_000 }));
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.monthlyRent).toBe(booking.monthlyRent);
    expect(after.deposit).toBe(booking.deposit);
    expect(after.firstPaymentTotal).toBe(booking.firstPaymentTotal);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).monthlyRent).toBe(1_200_000);
  });

  test("getAdminHost creates host once and reuses it", async () => {
    const admin = await makeAdmin(prisma, { email: "ops@example.com" });
    const a = await getAdminHost(prisma, admin.id);
    const b = await getAdminHost(prisma, admin.id);
    expect(b.id).toBe(a.id);
    expect(a.displayName).toBe("ops@example.com");
    expect(await prisma.host.count({ where: { userId: admin.id } })).toBe(1);
  });
});
