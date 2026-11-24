import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Booking, Room, User } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { BookingError } from "@/server/bookings/errors";
import { isRoomFree } from "@/server/bookings/availability";
import {
  approveRequest,
  cancelBooking,
  confirmOfflinePayment,
  confirmPaid,
  createRequest,
  expireDue,
  markCompleted,
  markDepositReturned,
  rejectRequest,
  withdrawRequest,
  type RequestInput,
} from "@/server/bookings/service";
import { makeGuest, makeRoom, resetDb } from "./factories";

// Lets one test bypass the advisory availability check to reach the DB constraint.
const forceRoomFree = vi.hoisted(() => ({ value: false }));
vi.mock("@/server/bookings/availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bookings/availability")>();
  return {
    ...actual,
    isRoomFree: (...args: Parameters<typeof actual.isRoomFree>) =>
      forceRoomFree.value ? Promise.resolve(true) : actual.isRoomFree(...args),
  };
});

/** Waits until `n` backends are blocked on a lock (i.e. parked behind a FOR UPDATE). */
async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (count >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${n} lock waiters`);
}

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const now = new Date("2027-03-01T03:00:00Z"); // KST 2027-03-01 12:00
const HOUR = 3600_000;
const at = (iso: string) => new Date(iso);

function req(room: Room, guest: User, o: Partial<RequestInput> = {}): RequestInput {
  return {
    roomId: room.id,
    guestId: guest.id,
    moveIn: "2027-03-15",
    lastNight: "2027-05-14",
    occupants: 1,
    guestName: "Jane Doe",
    nationality: "US",
    gender: "female",
    contact: "jane@example.com",
    message: "Hello",
    ...o,
  };
}

async function expectBookingError(p: Promise<unknown>, code: BookingError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BookingError);
  expect((err as BookingError).code).toBe(code);
  return err as BookingError;
}

async function requestOn(room: Room, o: Partial<RequestInput> = {}, when = now) {
  const guest = await makeGuest(prisma);
  return createRequest(prisma, req(room, guest, o), when);
}

/** Card payment row as the PG verification step (phase 4) would leave it. */
function paidCardPayment(b: Booking, o: { currency?: "KRW" | "USD"; amountChargedMinor?: number; amountKrw?: number } = {}) {
  return prisma.payment.create({
    data: {
      bookingId: b.id,
      method: o.currency === "USD" ? "paypal" : "card",
      currency: o.currency ?? "KRW",
      amountKrw: o.amountKrw ?? b.firstPaymentTotal,
      amountChargedMinor: o.amountChargedMinor ?? b.firstPaymentTotal,
      status: "paid",
      paidAt: now,
    },
  });
}

/** requested -> awaiting_payment -> confirmed (card, KRW). */
async function confirmedBooking(room: Room, o: Partial<RequestInput> = {}) {
  const b = await requestOn(room, o);
  await approveRequest(prisma, b.id, now);
  const p = await paidCardPayment(b);
  await confirmPaid(prisma, b.id, p.id, now);
  return prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
}

describe("createRequest", () => {
  test("createRequest stores price snapshot and 48h expiry", async () => {
    const room = await makeRoom(prisma);
    const guest = await makeGuest(prisma);
    const b = await createRequest(prisma, req(room, guest, { moveIn: "2027-03-15", lastNight: "2027-05-14" }), now);
    expect(b.status).toBe("requested");
    expect(b.moveIn).toEqual(new Date("2027-03-15"));
    expect(b.moveOut).toEqual(new Date("2027-05-15"));
    expect(b.monthlyRent).toBe(800_000);
    expect(b.deposit).toBe(500_000);
    expect(b.fullMonths).toBe(2);
    expect(b.extraDays).toBe(0);
    expect(b.stayTotal).toBe(1_600_000);
    expect(b.firstRentAmount).toBe(800_000);
    expect(b.firstPaymentTotal).toBe(1_300_000);
    expect(b.requestExpiresAt).toEqual(new Date(now.getTime() + 48 * 3600_000));
    expect(b.guestId).toBe(guest.id);
  });

  test.each([
    [{ moveIn: "2027-03-03" }, "TOO_SOON"], // today+2
    [{ roomAvailableFrom: "2027-04-01" }, "BEFORE_AVAILABLE"], // room opens 4/1, request 3/15
    [{ occupants: 2 }, "TOO_MANY_OCCUPANTS"],
    [{ lastNight: "2027-04-10" }, "PRICING"], // under one month
  ] as const)("createRequest rejects %o with %s", async (o, code) => {
    const { roomAvailableFrom, ...input } = { roomAvailableFrom: undefined, ...o } as Partial<RequestInput> & {
      roomAvailableFrom?: string;
    };
    const room = await makeRoom(prisma, roomAvailableFrom ? { availableFrom: roomAvailableFrom } : {});
    const guest = await makeGuest(prisma);
    const err = await expectBookingError(createRequest(prisma, req(room, guest, input), now), code);
    if (code === "PRICING") expect(err.detail).toBe("MIN_STAY");
  });

  test("gender: female room rejects male co-occupant", async () => {
    const room = await makeRoom(prisma, { genderPolicy: "female", maxOccupants: 2 });
    const guest = await makeGuest(prisma);
    await expectBookingError(
      createRequest(
        prisma,
        req(room, guest, { occupants: 2, gender: "female", coOccupantName: "Bob", coOccupantGender: "male" }),
        now,
      ),
      "GENDER_MISMATCH",
    );
    // Two women are fine.
    const ok = await createRequest(
      prisma,
      req(room, guest, { occupants: 2, gender: "female", coOccupantName: "Ann", coOccupantGender: "female" }),
      now,
    );
    expect(ok.status).toBe("requested");
  });

  test("gender: male guest cannot request a female room", async () => {
    const room = await makeRoom(prisma, { genderPolicy: "female" });
    const guest = await makeGuest(prisma);
    await expectBookingError(createRequest(prisma, req(room, guest, { gender: "male" }), now), "GENDER_MISMATCH");
  });

  test("createRequest moveIn exactly today+3 is allowed", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room, { moveIn: "2027-03-04", lastNight: "2027-04-03" });
    expect(b.status).toBe("requested");
  });

  test("unknown room / unpublished room or house", async () => {
    const guest = await makeGuest(prisma);
    const room = await makeRoom(prisma);
    await expectBookingError(
      createRequest(prisma, { ...req(room, guest), roomId: "00000000-0000-0000-0000-000000000000" }, now),
      "ROOM_NOT_FOUND",
    );
    const hiddenRoom = await makeRoom(prisma, { status: "hidden" });
    await expectBookingError(createRequest(prisma, req(hiddenRoom, guest), now), "ROOM_NOT_PUBLISHED");
    const draftHouseRoom = await makeRoom(prisma);
    await prisma.house.update({ where: { id: draftHouseRoom.houseId }, data: { status: "draft" } });
    await expectBookingError(createRequest(prisma, req(draftHouseRoom, guest), now), "ROOM_NOT_PUBLISHED");
  });

  test("overlapping requests may coexist, but an occupied period is refused", async () => {
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" });
    expect(b.status).toBe("requested");
    await approveRequest(prisma, a.id, now);
    await expectBookingError(requestOn(room, { moveIn: "2027-05-01", lastNight: "2027-06-30" }), "ROOM_UNAVAILABLE");
  });
});

describe("isRoomFree", () => {
  test("blocks and occupying bookings make the room busy; expired holds and adjacent ranges do not", async () => {
    const room = await makeRoom(prisma);
    expect(await isRoomFree(prisma, room.id, "2027-03-15", "2027-05-15", now)).toBe(true);

    const a = await requestOn(room);
    await approveRequest(prisma, a.id, now); // hold until now+24h
    expect(await isRoomFree(prisma, room.id, "2027-05-01", "2027-06-01", now)).toBe(false);
    expect(await isRoomFree(prisma, room.id, "2027-05-15", "2027-06-15", now)).toBe(true); // adjacent
    expect(await isRoomFree(prisma, room.id, "2027-05-01", "2027-06-01", now, a.id)).toBe(true); // excluded
    // Hold expired (stored status still awaiting_payment): not occupying.
    expect(await isRoomFree(prisma, room.id, "2027-05-01", "2027-06-01", new Date(now.getTime() + 25 * HOUR))).toBe(true);

    await prisma.roomBlock.create({
      data: { roomId: room.id, startDate: new Date("2027-07-01"), endDateExclusive: new Date("2027-07-10") },
    });
    expect(await isRoomFree(prisma, room.id, "2027-07-09", "2027-08-09", now)).toBe(false);
    expect(await isRoomFree(prisma, room.id, "2027-07-10", "2027-08-10", now)).toBe(true);
    expect(await isRoomFree(prisma, room.id, "2027-06-01", "2027-07-01", now)).toBe(true);
  });
});

describe("approve / reject / withdraw", () => {
  test("approve sets 24h hold and keeps the request-time price", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await prisma.room.update({ where: { id: room.id }, data: { monthlyRent: 900_000 } });
    const approved = await approveRequest(prisma, b.id, now);
    expect(approved.status).toBe("awaiting_payment");
    expect(approved.approvedAt).toEqual(now);
    expect(approved.holdExpiresAt).toEqual(new Date(now.getTime() + 24 * 3600_000));
    expect(approved.monthlyRent).toBe(800_000);
    expect(approved.firstPaymentTotal).toBe(1_300_000);
  });

  test("approving two overlapping requests concurrently: exactly one succeeds", async () => {
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" });

    // Start both approvals on their own connections, park them on the row locks, then release
    // them together so their transactions genuinely overlap (otherwise the first one can
    // commit before the second has even opened its connection).
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));
    let gateLocked!: () => void;
    const locked = new Promise<void>((r) => (gateLocked = r));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id IN (${a.id}, ${b.id}) FOR UPDATE`;
      gateLocked();
      await gate;
    });
    await locked;
    const approvals = Promise.allSettled([approveRequest(prisma, a.id, now), approveRequest(prisma, b.id, now)]);
    await waitForLockWaiters(2);
    releaseGate();
    await holder;
    const results = await approvals;

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(BookingError);
    expect((reason as BookingError).code).toBe("ROOM_UNAVAILABLE");
    const occupying = await prisma.booking.count({ where: { roomId: room.id, status: "awaiting_payment" } });
    expect(occupying).toBe(1);
  });

  test("an exclusion-constraint violation on approve surfaces as ROOM_UNAVAILABLE", async () => {
    // Simulate the race the advisory check cannot see: it says free, the DB says no.
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" });
    await approveRequest(prisma, a.id, now);
    forceRoomFree.value = true;
    try {
      const err = await expectBookingError(approveRequest(prisma, b.id, now), "ROOM_UNAVAILABLE");
      expect(err.detail).toBe("booking_no_overlap");
    } finally {
      forceRoomFree.value = false;
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("requested");
  });

  test("approve fails when the period overlaps a room block", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await prisma.roomBlock.create({
      data: { roomId: room.id, startDate: new Date("2027-04-01"), endDateExclusive: new Date("2027-04-05") },
    });
    await expectBookingError(approveRequest(prisma, b.id, now), "ROOM_UNAVAILABLE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("requested");
  });

  test("approve succeeds over a stale (expired, cron not yet run) hold", async () => {
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    await approveRequest(prisma, a.id, now);
    const later = new Date(now.getTime() + 25 * HOUR);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" }, later);
    const approved = await approveRequest(prisma, b.id, later);
    expect(approved.status).toBe("awaiting_payment");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("payment_expired");
  });

  test("approve on an expired request fails with INVALID_STATE", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await expectBookingError(approveRequest(prisma, b.id, new Date(now.getTime() + 49 * HOUR)), "INVALID_STATE");
    // The expiry is persisted even though the approval failed.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("request_expired");
  });

  test("approve twice fails with INVALID_STATE", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    await expectBookingError(approveRequest(prisma, b.id, now), "INVALID_STATE");
  });

  test("reject stores the reason; withdraw only by the owning guest", async () => {
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    const rejected = await rejectRequest(prisma, a.id, "Room under repair", now);
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectedReason).toBe("Room under repair");
    await expectBookingError(rejectRequest(prisma, a.id, "again", now), "INVALID_STATE");

    const b = await requestOn(room);
    const stranger = await makeGuest(prisma);
    await expectBookingError(withdrawRequest(prisma, b.id, stranger.id, now), "FORBIDDEN");
    const withdrawn = await withdrawRequest(prisma, b.id, b.guestId, now);
    expect(withdrawn.status).toBe("withdrawn");
    await expectBookingError(withdrawRequest(prisma, b.id, b.guestId, now), "INVALID_STATE");
  });
});

describe("payment", () => {
  test("confirmPaid confirms and auto-rejects overlapping requests", async () => {
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" });
    const c = await requestOn(room, { moveIn: "2027-05-15", lastNight: "2027-06-14" }); // adjacent
    const otherRoom = await makeRoom(prisma);
    const d = await requestOn(otherRoom);
    await approveRequest(prisma, a.id, now);
    const p = await paidCardPayment(a);

    const res = await confirmPaid(prisma, a.id, p.id, now);
    expect(res).toEqual({ result: "confirmed", autoRejectedIds: [b.id] });

    const rows = await prisma.booking.findMany({ where: { id: { in: [a.id, b.id, c.id, d.id] } } });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[a.id].status).toBe("confirmed");
    expect(byId[a.id].confirmedAt).toEqual(now);
    expect(byId[a.id].confirmedPaymentId).toBe(p.id);
    expect(byId[b.id].status).toBe("rejected");
    expect(byId[b.id].rejectedReason).toMatch(/auto/);
    expect(byId[c.id].status).toBe("requested");
    expect(byId[d.id].status).toBe("requested");
  });

  test("confirmPaid after hold expiry (cron not yet run) returns late_payment", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    const approved = await approveRequest(prisma, b.id, now);
    const p = await paidCardPayment(b);
    const late = new Date(approved.holdExpiresAt!.getTime() + 1000);
    const res = await confirmPaid(prisma, b.id, p.id, late);
    expect(res).toEqual({ result: "late_payment", refundId: expect.any(String) });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("payment_expired");
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: (res as { refundId: string }).refundId } });
    expect(refund).toMatchObject({
      paymentId: p.id,
      reason: "late_payment_auto",
      amountKrw: 1_300_000,
      amountRefundedMinor: 1_300_000,
      status: "pending",
      manual: false,
    });
  });

  test("late payment repeated: same refundId, exactly one refund row", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    const p = await paidCardPayment(b, { currency: "USD", amountChargedMinor: 98_765 });
    const late = new Date(now.getTime() + 25 * HOUR);
    await expireDue(prisma, late); // cron already ran this time
    const first = await confirmPaid(prisma, b.id, p.id, late);
    const second = await confirmPaid(prisma, b.id, p.id, new Date(late.getTime() + HOUR));
    expect(first).toEqual({ result: "late_payment", refundId: expect.any(String) });
    expect(second).toEqual(first);
    const refunds = await prisma.refund.findMany({ where: { paymentId: p.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountKrw: 1_300_000, amountRefundedMinor: 98_765 });
  });

  test("confirmPaid twice with the same payment: second returns already_confirmed, booking unchanged", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    const p = await paidCardPayment(b);
    expect(await confirmPaid(prisma, b.id, p.id, now)).toEqual({ result: "confirmed", autoRejectedIds: [] });
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(before.confirmedPaymentId).toBe(p.id);
    expect(await confirmPaid(prisma, b.id, p.id, new Date(now.getTime() + HOUR))).toEqual({
      result: "already_confirmed",
    });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).toEqual(before);
    expect(await prisma.refund.count()).toBe(0);
  });

  test("webhook and redirect confirming at once: one confirmed, one already_confirmed", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    const p = await paidCardPayment(b);
    const results = await Promise.all([confirmPaid(prisma, b.id, p.id, now), confirmPaid(prisma, b.id, p.id, now)]);
    expect(results.map((r) => r.result).sort()).toEqual(["already_confirmed", "confirmed"]);
  });

  test("a second, different paid payment on a confirmed booking → duplicate_payment with one refund", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    const second = await paidCardPayment(b);
    const r1 = await confirmPaid(prisma, b.id, second.id, now);
    const r2 = await confirmPaid(prisma, b.id, second.id, now);
    expect(r1).toEqual({ result: "duplicate_payment", refundId: expect.any(String) });
    expect(r2).toEqual(r1);
    const refunds = await prisma.refund.findMany({ where: { paymentId: second.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: "duplicate_payment_auto", amountKrw: 1_300_000, status: "pending" });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("confirmed");
    expect(after.confirmedPaymentId).not.toBe(second.id);
  });

  test("repeat confirmPaid for the confirming payment after cancellation → already_confirmed, no extra refund", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    const p = await paidCardPayment(b);
    await confirmPaid(prisma, b.id, p.id, now);
    const cancel = await cancelBooking(prisma, b.id, { kind: "guest", userId: b.guestId }, at("2027-03-05T00:00:00Z"));
    const res = await confirmPaid(prisma, b.id, p.id, at("2027-03-05T01:00:00Z"));
    expect(res).toEqual({ result: "already_confirmed" });
    const refunds = await prisma.refund.findMany({ where: { paymentId: p.id } });
    expect(refunds.map((r) => [r.id, r.reason])).toEqual([[cancel.refundIds[0], "guest_cancel_full"]]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("cancelled");
  });

  test("duplicate payment re-delivered after cancellation → the existing auto refund, no second one", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    const dup = await paidCardPayment(b);
    const first = await confirmPaid(prisma, b.id, dup.id, now);
    expect(first).toEqual({ result: "duplicate_payment", refundId: expect.any(String) });
    await cancelBooking(prisma, b.id, { kind: "guest", userId: b.guestId }, at("2027-03-05T00:00:00Z"));
    const again = await confirmPaid(prisma, b.id, dup.id, at("2027-03-05T01:00:00Z"));
    expect(again).toEqual(first);
    const refunds = await prisma.refund.findMany({ where: { paymentId: dup.id } });
    expect(refunds.map((r) => [r.id, r.reason])).toEqual([[(first as { refundId: string }).refundId, "duplicate_payment_auto"]]);
  });

  test("repeat confirmPaid stays idempotent after the payment is marked refunded", async () => {
    // Confirming payment: still already_confirmed.
    const b1 = await confirmedBooking(await makeRoom(prisma));
    await prisma.payment.update({ where: { id: b1.confirmedPaymentId! }, data: { status: "refunded" } });
    expect(await confirmPaid(prisma, b1.id, b1.confirmedPaymentId!, now)).toEqual({ result: "already_confirmed" });

    // Late payment: still the same refund.
    const b2 = await requestOn(await makeRoom(prisma));
    await approveRequest(prisma, b2.id, now);
    const p = await paidCardPayment(b2);
    const late = new Date(now.getTime() + 25 * HOUR);
    const first = await confirmPaid(prisma, b2.id, p.id, late);
    expect(first).toEqual({ result: "late_payment", refundId: expect.any(String) });
    await prisma.payment.update({ where: { id: p.id }, data: { status: "refunded" } });
    expect(await confirmPaid(prisma, b2.id, p.id, new Date(late.getTime() + HOUR))).toEqual(first);
    expect(await prisma.refund.count({ where: { paymentId: p.id } })).toBe(1);
  });

  test("paid payment on an admin-cancelled hold → late_payment with refund", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    await cancelBooking(prisma, b.id, { kind: "admin" }, now);
    const p = await paidCardPayment(b);
    const res = await confirmPaid(prisma, b.id, p.id, now);
    expect(res).toEqual({ result: "late_payment", refundId: expect.any(String) });
    expect(await prisma.refund.count({ where: { paymentId: p.id, reason: "late_payment_auto" } })).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("cancelled");
  });

  test("confirmPaid on a booking that was never approved fails with INVALID_STATE", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    const p = await paidCardPayment(b);
    await expectBookingError(confirmPaid(prisma, b.id, p.id, now), "INVALID_STATE");
    expect(await prisma.refund.count()).toBe(0);
  });

  test("confirmPaid rejects a payment that is unpaid, mismatched or for another booking", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    const wrongAmount = await paidCardPayment(b, { amountKrw: 1_000_000, amountChargedMinor: 1_000_000 });
    await expectBookingError(confirmPaid(prisma, b.id, wrongAmount.id, now), "AMOUNT_MISMATCH");
    const pending = await prisma.payment.create({
      data: { bookingId: b.id, method: "card", amountKrw: 1_300_000, amountChargedMinor: 1_300_000, status: "pending" },
    });
    await expectBookingError(confirmPaid(prisma, b.id, pending.id, now), "INVALID_STATE");
    const other = await requestOn(await makeRoom(prisma));
    const foreign = await paidCardPayment(other);
    await expectBookingError(confirmPaid(prisma, b.id, foreign.id, now), "INVALID_STATE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("awaiting_payment");
  });

  test("confirmOfflinePayment records an offline payment and confirms", async () => {
    const room = await makeRoom(prisma);
    const a = await requestOn(room);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" });
    await approveRequest(prisma, a.id, now);
    await expectBookingError(
      confirmOfflinePayment(prisma, a.id, { method: "bank_transfer", amountKrw: 1_299_999, note: "short" }, now),
      "AMOUNT_MISMATCH",
    );
    const res = await confirmOfflinePayment(
      prisma,
      a.id,
      { method: "bank_transfer", amountKrw: 1_300_000, note: "KB 123" },
      now,
    );
    expect(res).toEqual({ result: "confirmed", autoRejectedIds: [b.id] });
    const payments = await prisma.payment.findMany({ where: { bookingId: a.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      method: "offline",
      currency: "KRW",
      amountKrw: 1_300_000,
      amountChargedMinor: 1_300_000,
      status: "paid",
      offlineNote: "bank_transfer: KB 123",
      paidAt: now,
    });
    const confirmedA = await prisma.booking.findUniqueOrThrow({ where: { id: a.id } });
    expect(confirmedA.status).toBe("confirmed");
    expect(confirmedA.confirmedPaymentId).toBe(payments[0].id);
  });

  test("confirmOfflinePayment on a requested (unapproved) booking fails", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await expectBookingError(
      confirmOfflinePayment(prisma, b.id, { method: "cash", amountKrw: 1_300_000, note: "" }, now),
      "INVALID_STATE",
    );
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe("expireDue", () => {
  test("expireDue expires stale requests and holds", async () => {
    const roomA = await makeRoom(prisma);
    const roomB = await makeRoom(prisma);
    const staleReq = await requestOn(roomA);
    const freshReq = await requestOn(roomA, {}, new Date(now.getTime() + 10 * HOUR));
    const hold = await requestOn(roomB);
    await approveRequest(prisma, hold.id, now);

    const t = new Date(now.getTime() + 48 * HOUR); // exactly at staleReq's expiry
    const res = await expireDue(prisma, t);
    expect(res).toEqual({ requestExpired: [staleReq.id], paymentExpired: [hold.id] });

    const statuses = Object.fromEntries(
      (await prisma.booking.findMany()).map((b) => [b.id, b.status]),
    );
    expect(statuses[staleReq.id]).toBe("request_expired");
    expect(statuses[freshReq.id]).toBe("requested");
    expect(statuses[hold.id]).toBe("payment_expired");
    expect(await expireDue(prisma, t)).toEqual({ requestExpired: [], paymentExpired: [] });
  });
});

describe("cancel", () => {
  test("guest cancel before deadline → full refund row; after → deposit only; on move-in day → CANCEL_NOT_ALLOWED", async () => {
    // Before the deadline (3/8 23:59:59 KST): full refund.
    const b1 = await confirmedBooking(await makeRoom(prisma));
    const r1 = await cancelBooking(prisma, b1.id, { kind: "guest", userId: b1.guestId }, at("2027-03-08T14:59:59Z"));
    expect(r1.booking.status).toBe("cancelled");
    expect(r1.booking.cancelledAt).toEqual(at("2027-03-08T14:59:59Z"));
    expect(r1.booking.cancelReason).toBeTruthy();
    expect(r1.refund).toEqual({ kind: "full", amountKrw: 1_300_000 });
    expect(r1.refundIds).toHaveLength(1);
    const refund1 = await prisma.refund.findUniqueOrThrow({ where: { id: r1.refundIds[0] } });
    expect(refund1).toMatchObject({
      reason: "guest_cancel_full",
      amountKrw: 1_300_000,
      amountRefundedMinor: 1_300_000,
      status: "pending",
      manual: false,
    });

    // After the deadline: deposit only.
    const b2 = await confirmedBooking(await makeRoom(prisma));
    const r2 = await cancelBooking(prisma, b2.id, { kind: "guest", userId: b2.guestId }, at("2027-03-08T15:00:00Z"));
    expect(r2.refund).toEqual({ kind: "deposit_only", amountKrw: 500_000 });
    const refund2 = await prisma.refund.findUniqueOrThrow({ where: { id: r2.refundIds[0] } });
    expect(refund2).toMatchObject({ reason: "guest_cancel_deposit_only", amountKrw: 500_000, amountRefundedMinor: 500_000 });

    // Move-in day (KST): not allowed, nothing changes.
    const b3 = await confirmedBooking(await makeRoom(prisma));
    await expectBookingError(
      cancelBooking(prisma, b3.id, { kind: "guest", userId: b3.guestId }, at("2027-03-14T15:00:00Z")),
      "CANCEL_NOT_ALLOWED",
    );
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b3.id } })).status).toBe("confirmed");
    expect(await prisma.refund.count({ where: { payment: { bookingId: b3.id } } })).toBe(0);
  });

  test("cancel with expectedKind full after deadline → REFUND_CHANGED inside lock, nothing written", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    const guest = { kind: "guest" as const, userId: b.guestId };
    await expectBookingError(
      cancelBooking(prisma, b.id, guest, at("2027-03-08T15:00:00Z"), { expectedKind: "full" }),
      "REFUND_CHANGED",
    );
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("confirmed");
    expect(await prisma.refund.count({ where: { payment: { bookingId: b.id } } })).toBe(0);

    const ok = await cancelBooking(prisma, b.id, guest, at("2027-03-08T15:00:00Z"), { expectedKind: "deposit_only" });
    expect(ok.refund.kind).toBe("deposit_only");
  });

  test("cancel when the confirming payment is no longer paid → INVALID_STATE, no new refund", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    await prisma.payment.update({ where: { id: b.confirmedPaymentId! }, data: { status: "refunded" } });
    await expectBookingError(cancelBooking(prisma, b.id, { kind: "admin" }, at("2027-03-05T00:00:00Z")), "INVALID_STATE");
    expect(await prisma.refund.count({ where: { payment: { bookingId: b.id } } })).toBe(0);
  });

  test("admin cancel of a confirmed booking refunds in full", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    const r = await cancelBooking(prisma, b.id, { kind: "admin" }, at("2027-03-12T00:00:00Z"));
    expect(r.refund).toEqual({ kind: "full", amountKrw: 1_300_000 });
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: r.refundIds[0] } });
    expect(refund.reason).toBe("admin_cancel");
  });

  test("USD payment refund is proportional to what was charged", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    const p = await paidCardPayment(b, { currency: "USD", amountChargedMinor: 98_765 });
    await confirmPaid(prisma, b.id, p.id, now);
    const r = await cancelBooking(prisma, b.id, { kind: "guest", userId: b.guestId }, at("2027-03-10T00:00:00Z"));
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: r.refundIds[0] } });
    // round(98765 * 500000 / 1300000) = round(37986.53...) = 37987
    expect(refund).toMatchObject({ reason: "guest_cancel_deposit_only", amountKrw: 500_000, amountRefundedMinor: 37_987 });
  });

  test("cancel with a duplicate payment refunds only the confirming payment", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    const dup = await paidCardPayment(b);
    const dupRes = await confirmPaid(prisma, b.id, dup.id, now);
    expect(dupRes).toEqual({ result: "duplicate_payment", refundId: expect.any(String) });

    const r = await cancelBooking(prisma, b.id, { kind: "guest", userId: b.guestId }, at("2027-03-05T00:00:00Z"));
    expect(r.refundIds).toHaveLength(1);
    const cancelRefund = await prisma.refund.findUniqueOrThrow({ where: { id: r.refundIds[0] } });
    expect(cancelRefund).toMatchObject({ paymentId: b.confirmedPaymentId, reason: "guest_cancel_full", amountKrw: 1_300_000 });
    const dupRefunds = await prisma.refund.findMany({ where: { paymentId: dup.id } });
    expect(dupRefunds.map((x) => [x.id, x.reason])).toEqual([
      [(dupRes as { refundId: string }).refundId, "duplicate_payment_auto"],
    ]);
  });

  test("guest cannot cancel someone else's booking", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    const stranger = await makeGuest(prisma);
    await expectBookingError(cancelBooking(prisma, b.id, { kind: "guest", userId: stranger.id }, now), "FORBIDDEN");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("confirmed");
  });

  test("offline-paid booking cancel creates manual refund row", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    await confirmOfflinePayment(prisma, b.id, { method: "cash", amountKrw: 1_300_000, note: "paid in person" }, now);
    const r = await cancelBooking(prisma, b.id, { kind: "guest", userId: b.guestId }, now);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: r.refundIds[0] } });
    expect(refund).toMatchObject({ manual: true, status: "pending", amountKrw: 1_300_000, amountRefundedMinor: 1_300_000 });
  });

  test("unpaid hold: admin may cancel without refund rows, guest may not", async () => {
    const room = await makeRoom(prisma);
    const b = await requestOn(room);
    await approveRequest(prisma, b.id, now);
    await expectBookingError(cancelBooking(prisma, b.id, { kind: "guest", userId: b.guestId }, now), "INVALID_STATE");
    const r = await cancelBooking(prisma, b.id, { kind: "admin" }, now);
    expect(r.booking.status).toBe("cancelled");
    expect(r.refund).toEqual({ kind: "not_allowed", amountKrw: 0 });
    expect(r.refundIds).toEqual([]);
    expect(await prisma.refund.count()).toBe(0);
  });

  test("cancelled booking frees the room for a new approval", async () => {
    const room = await makeRoom(prisma);
    const a = await confirmedBooking(room);
    await cancelBooking(prisma, a.id, { kind: "admin" }, now);
    const b = await requestOn(room, { moveIn: "2027-04-01", lastNight: "2027-05-31" });
    const approved = await approveRequest(prisma, b.id, now);
    expect(approved.status).toBe("awaiting_payment");
  });
});

describe("after move-in", () => {
  test("markCompleted from move-in day, then deposit returned", async () => {
    const b = await confirmedBooking(await makeRoom(prisma));
    await expectBookingError(markDepositReturned(prisma, b.id, "early", now), "INVALID_STATE");
    await expectBookingError(markCompleted(prisma, b.id, at("2027-03-14T14:59:59Z")), "INVALID_STATE");
    const completed = await markCompleted(prisma, b.id, at("2027-03-14T15:00:00Z"));
    expect(completed.status).toBe("completed");

    const t = at("2027-05-20T00:00:00Z");
    const returned = await markDepositReturned(prisma, b.id, "Returned 500,000 by transfer", t);
    expect(returned.depositReturnedAt).toEqual(t);
    expect(returned.depositReturnNote).toBe("Returned 500,000 by transfer");
    await expectBookingError(markDepositReturned(prisma, b.id, "again", t), "INVALID_STATE");
  });

  test("markCompleted requires a confirmed booking", async () => {
    const b = await requestOn(await makeRoom(prisma));
    await expectBookingError(markCompleted(prisma, b.id, at("2027-03-20T00:00:00Z")), "INVALID_STATE");
  });
});
