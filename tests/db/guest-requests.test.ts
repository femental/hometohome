import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/server/env", () => ({
  serverEnv: () => ({ APP_URL: "http://localhost:3000", ADMIN_EMAILS: ["admin@example.com"] }),
}));

import { quoteAction } from "@/app/[locale]/rooms/[id]/actions";
import { BookingError } from "@/server/bookings/errors";
import { prisma } from "@/server/db";
import { MemoryEmailSender } from "@/server/email/sender";
import { quoteRoom, submitRequest, type RequestFields } from "@/server/guest/requests";
import { makeBooking, makeGuest, makeRoom, resetDb } from "./factories";

const now = new Date("2027-01-01T00:00:00Z");

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

function fields(roomId: string, patch: Partial<RequestFields> = {}): RequestFields {
  return {
    roomId,
    moveIn: "2027-03-15",
    lastNight: "2027-05-14",
    occupants: 1,
    guestName: "Gina Kim",
    nationality: "United States",
    gender: "female",
    contact: "+1 555 0100",
    message: "Hello",
    ...patch,
  };
}

function deps(email = new MemoryEmailSender()) {
  return {
    db: prisma,
    email,
    now,
    appUrl: "https://app.example.com",
    adminEmails: ["a1@example.com", "a2@example.com"],
  };
}

describe("submitRequest", () => {
  test("creates booking and sends request_received (guest locale) + admin_new_request (ko, each admin)", async () => {
    const room = await makeRoom(prisma, { name: { en: "Room 101", ko: "101호" } }, { name: { en: "Hongdae House", ko: "홍대 하우스" } });
    const guest = await makeGuest(prisma, { locale: "ko" });
    const email = new MemoryEmailSender();

    const { bookingId } = await submitRequest(deps(email), { id: guest.id, email: guest.email, locale: "ko" }, fields(room.id));

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking).toMatchObject({ guestId: guest.id, status: "requested", guestName: "Gina Kim", firstPaymentTotal: 1_300_000 });

    expect(email.sent.map((m) => m.to)).toEqual([guest.email, "a1@example.com", "a2@example.com"]);
    const [toGuest, toAdmin] = email.sent;
    expect(toGuest.subject).toBe("예약 신청이 접수되었습니다 – 홍대 하우스 · 101호");
    expect(toAdmin.subject).toBe("[운영] 새 예약 신청 – 홍대 하우스 · 101호");
    expect(toAdmin.text).toContain(`https://app.example.com/admin/bookings/${bookingId}`);

    const logs = await prisma.emailLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.template, l.status, l.bookingId])).toEqual([
      ["request_received", "sent", bookingId],
      ["admin_new_request", "sent", bookingId],
      ["admin_new_request", "sent", bookingId],
    ]);
  });

  test("an English guest gets the English email", async () => {
    const room = await makeRoom(prisma);
    const guest = await makeGuest(prisma);
    const email = new MemoryEmailSender();
    await submitRequest(deps(email), { id: guest.id, email: guest.email, locale: "en" }, fields(room.id));
    expect(email.sent[0].subject).toBe("We received your booking request – Test House · Room 101");
  });

  test("submitRequest on unavailable dates → BookingError ROOM_UNAVAILABLE, no emails", async () => {
    const room = await makeRoom(prisma);
    const guest = await makeGuest(prisma);
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-04-01", moveOut: "2027-06-01", status: "confirmed" });
    const email = new MemoryEmailSender();

    const run = submitRequest(deps(email), { id: guest.id, email: guest.email, locale: "en" }, fields(room.id));
    await expect(run).rejects.toBeInstanceOf(BookingError);
    await expect(run).rejects.toMatchObject({ code: "ROOM_UNAVAILABLE" });
    expect(email.sent).toEqual([]);
    expect(await prisma.emailLog.count()).toBe(0);
    expect(await prisma.booking.count({ where: { guestId: guest.id } })).toBe(0);
  });

  test("submitRequest still succeeds when email fails", async () => {
    const room = await makeRoom(prisma);
    const guest = await makeGuest(prisma);
    const email = new MemoryEmailSender();
    email.failNext = true;

    const { bookingId } = await submitRequest(deps(email), { id: guest.id, email: guest.email, locale: "en" }, fields(room.id));

    expect(await prisma.booking.count({ where: { id: bookingId } })).toBe(1);
    const logs = await prisma.emailLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.status)).toEqual(["failed", "sent", "sent"]);
  });

  test("two occupants store the co-occupant", async () => {
    const room = await makeRoom(prisma, { maxOccupants: 2, extraPersonMonthlyFee: 100_000 });
    const guest = await makeGuest(prisma);
    const { bookingId } = await submitRequest(
      deps(),
      { id: guest.id, email: guest.email, locale: "en" },
      fields(room.id, { occupants: 2, coOccupantName: "Mina", coOccupantGender: "male" }),
    );
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking).toMatchObject({ occupants: 2, coOccupantName: "Mina", coOccupantGender: "male", monthlyRent: 900_000 });
  });
});

describe("quote", () => {
  const stay = { moveIn: "2027-03-15", lastNight: "2027-04-24", occupants: 1 as const };

  test("quoteRoom prices a published room from the server-side rule", async () => {
    const room = await makeRoom(prisma);
    const r = await quoteRoom(prisma, { roomId: room.id, ...stay }, now);
    expect(r).toEqual({
      ok: true,
      quote: {
        appliedMonthlyRent: 800_000,
        fullMonths: 1,
        extraDays: 10,
        proratedAmount: 266_667,
        stayTotal: 1_066_667,
        firstRentAmount: 1_066_667,
        deposit: 500_000,
        firstPaymentTotal: 1_566_667,
      },
    });
  });

  test("quoteAction rejects unpublished room and invalid ranges", async () => {
    const draft = await makeRoom(prisma, { status: "draft" });
    expect(await quoteAction({ roomId: draft.id, ...stay })).toEqual({ ok: false, error: "NOT_FOUND" });
    const inHiddenHouse = await makeRoom(prisma, {}, { status: "hidden" });
    expect(await quoteAction({ roomId: inHiddenHouse.id, ...stay })).toEqual({ ok: false, error: "NOT_FOUND" });

    const room = await makeRoom(prisma);
    // last night before move-in
    expect(await quoteAction({ roomId: room.id, moveIn: "2027-04-10", lastNight: "2027-04-01", occupants: 1 })).toEqual({
      ok: false,
      error: "PRICING",
    });
    // shorter than one month
    expect(await quoteAction({ roomId: room.id, moveIn: "2027-04-10", lastNight: "2027-04-20", occupants: 1 })).toEqual({
      ok: false,
      error: "PRICING",
    });
    // malformed
    expect(await quoteAction({ roomId: room.id, moveIn: "2027-02-30", lastNight: "2027-04-20", occupants: 1 })).toEqual({
      ok: false,
      error: "VALIDATION",
    });
  });

  test("quoteRoom reports the same refusals a request would get", async () => {
    const room = await makeRoom(prisma, { availableFrom: "2027-04-01" });
    expect(await quoteRoom(prisma, { roomId: room.id, ...stay }, now)).toEqual({ ok: false, error: "BEFORE_AVAILABLE" });
    expect(await quoteRoom(prisma, { roomId: room.id, ...stay, moveIn: "2027-01-02", lastNight: "2027-04-01" }, now)).toEqual({
      ok: false,
      error: "TOO_SOON",
    });
    const single = await makeRoom(prisma);
    expect(await quoteRoom(prisma, { roomId: single.id, ...stay, occupants: 2 }, now)).toEqual({
      ok: false,
      error: "TOO_MANY_OCCUPANTS",
    });
    await makeBooking(prisma, { roomId: single.id, moveIn: "2027-04-01", moveOut: "2027-06-01", status: "confirmed" });
    expect(await quoteRoom(prisma, { roomId: single.id, ...stay }, now)).toEqual({ ok: false, error: "ROOM_UNAVAILABLE" });
  });
});
