import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { getPublicHouse, getPublicRoom } from "@/server/guest/catalog";
import { makeBooking, makeRoom, resetDb } from "./factories";

const now = new Date("2027-01-01T00:00:00Z");

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

describe("guest catalog", () => {
  test("published house with rooms is returned; draft/hidden rooms excluded", async () => {
    const pub = await makeRoom(prisma, { name: { en: "Pub" } });
    await makeRoom(prisma, { houseId: pub.houseId, status: "draft", name: { en: "Draft" } });
    await makeRoom(prisma, { houseId: pub.houseId, status: "hidden", name: { en: "Hidden" } });
    const house = await getPublicHouse(prisma, pub.houseId, { now });
    expect(house?.rooms.map((r) => r.id)).toEqual([pub.id]);
    expect(house?.rooms[0].available).toBeUndefined();
    expect(house).not.toHaveProperty("hostId");
    expect(house).not.toHaveProperty("status");
    const room = await getPublicRoom(prisma, pub.id);
    expect(room?.house.id).toBe(pub.houseId);
    expect(room?.house).not.toHaveProperty("rooms");
  });

  test("hidden house → null; room of hidden house → null; malformed id → null", async () => {
    const room = await makeRoom(prisma, {}, { status: "hidden" });
    expect(await getPublicHouse(prisma, room.houseId, { now })).toBeNull();
    expect(await getPublicRoom(prisma, room.id)).toBeNull();
    const draftRoom = await makeRoom(prisma, { status: "draft" });
    expect(await getPublicRoom(prisma, draftRoom.id)).toBeNull();
    expect(await getPublicHouse(prisma, "not-a-uuid", { now })).toBeNull();
    expect(await getPublicRoom(prisma, "not-a-uuid")).toBeNull();
  });

  test("availability per room for given dates (confirmed overlap → false, adjacent → true)", async () => {
    const taken = await makeRoom(prisma, { name: { en: "Taken" } });
    const adjacent = await makeRoom(prisma, { houseId: taken.houseId, name: { en: "Adj" } });
    const late = await makeRoom(prisma, { houseId: taken.houseId, availableFrom: "2027-03-01", name: { en: "Late" } });
    await makeBooking(prisma, { roomId: taken.id, moveIn: "2027-01-10", moveOut: "2027-02-11", status: "confirmed" });
    await makeBooking(prisma, { roomId: adjacent.id, moveIn: "2027-01-01", moveOut: "2027-02-01", status: "confirmed" });
    const house = await getPublicHouse(prisma, taken.houseId, { moveIn: "2027-02-01", lastNight: "2027-02-28", now });
    const by = Object.fromEntries(house!.rooms.map((r) => [r.id, r.available]));
    expect(by).toEqual({ [taken.id]: false, [adjacent.id]: true, [late.id]: false });
    const bad = await getPublicHouse(prisma, taken.houseId, { moveIn: "2027-02-10", lastNight: "2027-02-01", now });
    expect(bad!.rooms.every((r) => r.available === undefined)).toBe(true);
    const junk = await getPublicHouse(prisma, taken.houseId, { moveIn: "nope", lastNight: "2027-02-01", now });
    expect(junk!.rooms.every((r) => r.available === undefined)).toBe(true);
  });

  test("photos ordered and mapped to public URLs", async () => {
    const room = await makeRoom(prisma, { name: { en: "Rm" } }, { name: { en: "Hse" } });
    await prisma.housePhoto.createMany({
      data: [
        { houseId: room.houseId, storagePath: "h/b.jpg", sortOrder: 2 },
        { houseId: room.houseId, storagePath: "h/a.jpg", sortOrder: 1 },
      ],
    });
    await prisma.roomPhoto.createMany({
      data: [
        { roomId: room.id, storagePath: "r/z.jpg", sortOrder: 5 },
        { roomId: room.id, storagePath: "r/y.jpg", sortOrder: 0 },
      ],
    });
    const house = await getPublicHouse(prisma, room.houseId, { now });
    expect(house!.photos.map((p) => p.url.split("/photos/")[1])).toEqual(["h/a.jpg", "h/b.jpg"]);
    expect(house!.photos[0].alt).toBe("Hse");
    expect(house!.rooms[0].coverPhotoUrl).toMatch(/r\/y\.jpg$/);
    const r = await getPublicRoom(prisma, room.id);
    expect(r!.photos.map((p) => p.url.split("/photos/")[1])).toEqual(["r/y.jpg", "r/z.jpg"]);
    expect(r!.photos[0].alt).toBe("Rm");
  });
});
