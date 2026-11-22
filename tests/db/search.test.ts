import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { searchRooms } from "@/server/rooms/search";
import { makeBooking, makeRoom, resetDb } from "./factories";

const now = new Date("2027-01-01T00:00:00Z");
const ids = (rs: { roomId: string }[]) => rs.map((r) => r.roomId);
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

describe("searchRooms", () => {
  test("excludes rooms with overlapping confirmed booking, includes adjacent", async () => {
    const taken = await makeRoom(prisma, { monthlyRent: 700_000 });
    const adjacent = await makeRoom(prisma, { monthlyRent: 800_000 });
    const free = await makeRoom(prisma, { monthlyRent: 900_000 });
    await makeBooking(prisma, { roomId: taken.id, moveIn: "2027-01-10", moveOut: "2027-02-11", status: "confirmed" });
    // moveOut 2027-02-01 == searched moveIn -> adjacent, allowed
    await makeBooking(prisma, { roomId: adjacent.id, moveIn: "2027-01-01", moveOut: "2027-02-01", status: "confirmed" });
    const r = await searchRooms(prisma, { moveIn: "2027-02-01", lastNight: "2027-02-28" }, now);
    expect(ids(r)).toEqual([adjacent.id, free.id]);
  });

  test("awaiting_payment blocks only while hold is active", async () => {
    const live = await makeRoom(prisma, { monthlyRent: 700_000 });
    const expired = await makeRoom(prisma, { monthlyRent: 800_000 });
    await makeBooking(prisma, { roomId: live.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "awaiting_payment", holdExpiresAt: new Date("2027-01-02T00:00:00Z") });
    await makeBooking(prisma, { roomId: expired.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "awaiting_payment", holdExpiresAt: new Date("2026-12-31T00:00:00Z") });
    const r = await searchRooms(prisma, { moveIn: "2027-02-01", lastNight: "2027-02-28" }, now);
    expect(ids(r)).toEqual([expired.id]);
  });

  test("expired hold does not block search (hold_expires_at == now is expired)", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status: "awaiting_payment", holdExpiresAt: now });
    const r = await searchRooms(prisma, { moveIn: "2027-02-01", lastNight: "2027-02-28" }, now);
    expect(ids(r)).toEqual([room.id]);
  });

  test("non-occupying statuses do not block", async () => {
    const room = await makeRoom(prisma);
    for (const status of ["requested", "cancelled", "completed", "rejected"] as const) {
      await makeBooking(prisma, { roomId: room.id, moveIn: "2027-02-01", moveOut: "2027-03-01", status });
    }
    const r = await searchRooms(prisma, { moveIn: "2027-02-01", lastNight: "2027-02-28" }, now);
    expect(ids(r)).toEqual([room.id]);
  });

  test("excludes rooms whose availableFrom is after moveIn", async () => {
    await makeRoom(prisma, { availableFrom: "2027-03-01" });
    const exact = await makeRoom(prisma, { availableFrom: "2027-02-01", monthlyRent: 900_000 });
    const r = await searchRooms(prisma, { moveIn: "2027-02-01", lastNight: "2027-02-28" }, now);
    expect(ids(r)).toEqual([exact.id]);
    expect(r[0].availableFrom).toBe("2027-02-01");
  });

  test("excludes blocked periods, allows adjacent block", async () => {
    const blocked = await makeRoom(prisma, { monthlyRent: 700_000 });
    const adjacent = await makeRoom(prisma, { monthlyRent: 800_000 });
    await prisma.roomBlock.create({ data: { roomId: blocked.id, startDate: d("2027-02-10"), endDateExclusive: d("2027-02-12") } });
    await prisma.roomBlock.create({ data: { roomId: adjacent.id, startDate: d("2027-03-01"), endDateExclusive: d("2027-03-10") } });
    const r = await searchRooms(prisma, { moveIn: "2027-02-01", lastNight: "2027-02-28" }, now);
    expect(ids(r)).toEqual([adjacent.id]);
  });

  test("filters: rent range, districts, roomType, genderPolicy, occupants", async () => {
    const a = await makeRoom(prisma, { monthlyRent: 600_000 });
    const b = await makeRoom(prisma, { monthlyRent: 800_000, roomType: "double", maxOccupants: 2, genderPolicy: "female" }, { district: "gangnam" });
    const c = await makeRoom(prisma, { monthlyRent: 1_000_000 });
    expect(ids(await searchRooms(prisma, { minRent: 700_000, maxRent: 900_000 }, now))).toEqual([b.id]);
    expect(ids(await searchRooms(prisma, { districts: ["gangnam"] }, now))).toEqual([b.id]);
    expect(ids(await searchRooms(prisma, { districts: ["mapo", "gangnam"] }, now))).toEqual([a.id, b.id, c.id]);
    expect(ids(await searchRooms(prisma, { roomType: "double" }, now))).toEqual([b.id]);
    expect(ids(await searchRooms(prisma, { genderPolicy: "female" }, now))).toEqual([b.id]);
    expect(ids(await searchRooms(prisma, { occupants: 2 }, now))).toEqual([b.id]);
    expect(ids(await searchRooms(prisma, { occupants: 1 }, now))).toEqual([a.id, b.id, c.id]);
    expect(ids(await searchRooms(prisma, { districts: [] }, now))).toEqual([a.id, b.id, c.id]);
  });

  test("excludes unpublished house or room", async () => {
    const ok = await makeRoom(prisma);
    await makeRoom(prisma, { status: "draft" });
    await makeRoom(prisma, {}, { status: "hidden" });
    expect(ids(await searchRooms(prisma, {}, now))).toEqual([ok.id]);
  });

  test("no dates → all published rooms sorted by rent, with mapped fields and cover photo", async () => {
    const dear = await makeRoom(prisma, { monthlyRent: 900_000, name: { en: "Dear", ko: "비싼" } });
    const cheap = await makeRoom(prisma, { monthlyRent: 500_000, privateBathroom: true });
    await prisma.housePhoto.createMany({
      data: [
        { houseId: dear.houseId, storagePath: "h/2.jpg", sortOrder: 2 },
        { houseId: dear.houseId, storagePath: "h/1.jpg", sortOrder: 1 },
      ],
    });
    await prisma.roomPhoto.createMany({
      data: [
        { roomId: cheap.id, storagePath: "r/9.jpg", sortOrder: 9 },
        { roomId: cheap.id, storagePath: "r/3.jpg", sortOrder: 3 },
      ],
    });
    const r = await searchRooms(prisma, {}, now);
    expect(ids(r)).toEqual([cheap.id, dear.id]);
    expect(r[0].coverPhotoPath).toBe("r/3.jpg");
    expect(r[1].coverPhotoPath).toBe("h/1.jpg");
    expect(r[0]).toMatchObject({
      houseId: cheap.houseId,
      roomName: { en: "Room 101" },
      houseName: { en: "Test House" },
      district: "mapo",
      lat: 37.55,
      lng: 126.92,
      monthlyRent: 500_000,
      deposit: 500_000,
      availableFrom: "2027-01-01",
      roomType: "single",
      genderPolicy: "any",
      privateBathroom: true,
    });
    expect(r[1].roomName).toEqual({ en: "Dear", ko: "비싼" });
  });

  test("null cover photo when none; half or inverted range throws", async () => {
    await makeRoom(prisma);
    expect((await searchRooms(prisma, {}, now))[0].coverPhotoPath).toBeNull();
    await expect(searchRooms(prisma, { moveIn: "2027-02-01" }, now)).rejects.toThrow();
    await expect(searchRooms(prisma, { lastNight: "2027-02-01" }, now)).rejects.toThrow();
    await expect(searchRooms(prisma, { moveIn: "2027-02-05", lastNight: "2027-02-01" }, now)).rejects.toThrow();
  });
});
