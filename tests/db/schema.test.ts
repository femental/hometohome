import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { makeBooking, makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

describe("booking exclusion constraint", () => {
  test("overlapping occupying bookings on same room are rejected by DB", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
    await expect(
      makeBooking(prisma, { roomId: room.id, moveIn: "2027-05-01", moveOut: "2027-06-01", status: "awaiting_payment" }),
    ).rejects.toThrow(/booking_no_overlap/);
  });

  test("adjacent bookings are allowed", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
    await expect(
      makeBooking(prisma, { roomId: room.id, moveIn: "2027-05-15", moveOut: "2027-06-15", status: "confirmed" }),
    ).resolves.toBeTruthy();
  });

  test("non-occupying statuses may overlap", async () => {
    const room = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
    await expect(
      makeBooking(prisma, { roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "requested" }),
    ).resolves.toBeTruthy();
  });

  test("same dates on different rooms are allowed", async () => {
    const roomA = await makeRoom(prisma);
    const roomB = await makeRoom(prisma);
    await makeBooking(prisma, { roomId: roomA.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" });
    await expect(
      makeBooking(prisma, { roomId: roomB.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "confirmed" }),
    ).resolves.toBeTruthy();
  });

  test("move_out must be after move_in", async () => {
    const room = await makeRoom(prisma);
    const guestBooking = await makeBooking(prisma, {
      roomId: room.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "requested",
    });
    await expect(
      prisma.booking.update({ where: { id: guestBooking.id }, data: { moveOut: guestBooking.moveIn } }),
    ).rejects.toThrow(/booking_range_valid/);
  });
});
