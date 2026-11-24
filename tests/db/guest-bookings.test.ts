import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { BookingError } from "@/server/bookings/errors";
import { prisma } from "@/server/db";
import { MemoryEmailSender } from "@/server/email/sender";
import {
  getMyBooking,
  guestBookingErrorKey,
  guestCancel,
  guestPreviewCancel,
  guestWithdraw,
  listMyBookings,
} from "@/server/guest/bookings";
import { makeBooking, makeGuest, makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const NOW = new Date("2027-01-10T03:00:00Z"); // 12:00 KST
const ADMINS = ["a1@example.com", "a2@example.com"];
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

function deps(email = new MemoryEmailSender(), now = NOW) {
  return { db: prisma, email, now, appUrl: "https://app.test", adminEmails: ADMINS };
}

async function setup(
  opts: {
    status?: "requested" | "awaiting_payment" | "confirmed";
    moveIn?: string;
    moveOut?: string;
    locale?: string;
  } = {},
) {
  const guest = await makeGuest(prisma, { locale: opts.locale ?? "en", name: "Gina" });
  const other = await makeGuest(prisma, { name: "Otto" });
  const room = await makeRoom(
    prisma,
    { name: { en: "Room 101", ko: "101호" } },
    { name: { en: "Hongdae House", ko: "홍대 하우스" } },
  );
  const status = opts.status ?? "requested";
  const booking = await makeBooking(prisma, {
    roomId: room.id,
    guestId: guest.id,
    moveIn: opts.moveIn ?? "2027-03-01",
    moveOut: opts.moveOut ?? "2027-04-01",
    status,
    requestExpiresAt: status === "requested" ? hours(40) : null,
    holdExpiresAt: status === "awaiting_payment" ? hours(10) : null,
  });
  return { guest, other, room, booking };
}

async function confirmed(opts: { moveIn?: string; moveOut?: string; currency?: "KRW" | "USD"; locale?: string } = {}) {
  const s = await setup({ status: "confirmed", ...opts });
  const currency = opts.currency ?? "KRW";
  const payment = await prisma.payment.create({
    data: {
      bookingId: s.booking.id,
      method: "card",
      currency,
      amountKrw: s.booking.firstPaymentTotal,
      amountChargedMinor: currency === "USD" ? 123_457 : s.booking.firstPaymentTotal,
      fxRate: currency === "USD" ? "1350.1234" : null,
      status: "paid",
      paidAt: NOW,
    },
  });
  await prisma.booking.update({ where: { id: s.booking.id }, data: { confirmedPaymentId: payment.id, confirmedAt: NOW } });
  return { ...s, payment };
}

const statusOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe("reads", () => {
  test("getMyBooking returns null for another guest's booking", async () => {
    const { booking, guest, other } = await setup();
    expect(await getMyBooking(prisma, other.id, booking.id, NOW)).toBeNull();
    expect(await getMyBooking(prisma, guest.id, "not-a-uuid", NOW)).toBeNull();
    expect(await getMyBooking(prisma, guest.id, "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11", NOW)).toBeNull();

    const mine = await getMyBooking(prisma, guest.id, booking.id, NOW);
    expect(mine).toMatchObject({
      id: booking.id,
      status: "requested",
      moveIn: "2027-03-01",
      lastNight: "2027-03-31",
      house: { name: { en: "Hongdae House", ko: "홍대 하우스" } },
      room: { name: { en: "Room 101", ko: "101호" } },
      price: { firstPaymentTotal: booking.firstPaymentTotal, deposit: 500_000 },
      requestExpiresAt: hours(40),
    });
  });

  test("listMyBookings shows effective status (expired hold → payment_expired), newest first, own only", async () => {
    const guest = await makeGuest(prisma);
    const room = await makeRoom(prisma);
    const old = await makeBooking(prisma, {
      roomId: room.id,
      guestId: guest.id,
      moveIn: "2027-03-01",
      moveOut: "2027-04-01",
      status: "awaiting_payment",
      requestedAt: hours(-48),
      holdExpiresAt: hours(-1),
    });
    const recent = await makeBooking(prisma, {
      roomId: room.id,
      guestId: guest.id,
      moveIn: "2027-05-01",
      moveOut: "2027-06-01",
      status: "requested",
      requestedAt: hours(-2),
      requestExpiresAt: hours(46),
    });
    await makeBooking(prisma, { roomId: room.id, moveIn: "2027-07-01", moveOut: "2027-08-01", status: "requested" });

    const rows = await listMyBookings(prisma, guest.id, NOW);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [recent.id, "requested"],
      [old.id, "payment_expired"],
    ]);
    expect(rows[0]).toMatchObject({ roomName: { en: "Room 101" }, houseName: { en: "Test House" }, lastNight: "2027-05-31" });
    expect((await getMyBooking(prisma, guest.id, old.id, NOW))!.status).toBe("payment_expired");
  });
});

describe("withdraw", () => {
  test("withdraw/cancel on another guest's booking → not found, no state change", async () => {
    const { booking, other } = await setup();
    const w = guestWithdraw(deps(), other.id, booking.id);
    await expect(w).rejects.toBeInstanceOf(BookingError);
    expect(guestBookingErrorKey(await w.catch((e) => e))).toBe("NOT_FOUND");

    const c = await confirmed();
    const email = new MemoryEmailSender();
    const err = await guestCancel(deps(email), c.other.id, c.booking.id, "full").catch((e) => e);
    expect(guestBookingErrorKey(err)).toBe("NOT_FOUND");
    expect(await guestPreviewCancel(prisma, c.other.id, c.booking.id, NOW)).toBeNull();

    expect(await statusOf(booking.id)).toBe("requested");
    expect(await statusOf(c.booking.id)).toBe("confirmed");
    expect(await prisma.refund.count()).toBe(0);
    expect(email.sent).toEqual([]);
    // A booking that does not exist looks the same as someone else's.
    const missing = await guestWithdraw(deps(), other.id, "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11").catch((e) => e);
    expect(guestBookingErrorKey(missing)).toBe("NOT_FOUND");
  });

  test("guestWithdraw only from requested", async () => {
    const { booking, guest } = await setup();
    await guestWithdraw(deps(), guest.id, booking.id);
    expect(await statusOf(booking.id)).toBe("withdrawn");

    const hold = await setup({ status: "awaiting_payment" });
    const err = await guestWithdraw(deps(), hold.guest.id, hold.booking.id).catch((e) => e);
    expect(guestBookingErrorKey(err)).toBe("INVALID_STATE");
    expect(await statusOf(hold.booking.id)).toBe("awaiting_payment");

    const expired = await setup();
    await prisma.booking.update({ where: { id: expired.booking.id }, data: { requestExpiresAt: hours(-1) } });
    const err2 = await guestWithdraw(deps(), expired.guest.id, expired.booking.id).catch((e) => e);
    expect(guestBookingErrorKey(err2)).toBe("INVALID_STATE");
    expect(await statusOf(expired.booking.id)).toBe("request_expired");
  });
});

describe("cancel", () => {
  test("guestCancel before deadline → full refund rows + guest/admin emails", async () => {
    const { booking, guest, payment } = await confirmed({ locale: "ko" });
    const preview = await guestPreviewCancel(prisma, guest.id, booking.id, NOW);
    expect(preview).toMatchObject({ kind: "full", amountKrw: booking.firstPaymentTotal });

    const email = new MemoryEmailSender();
    const r = await guestCancel(deps(email), guest.id, booking.id, "full");
    expect(r).toMatchObject({ refundKrw: booking.firstPaymentTotal });
    expect(await statusOf(booking.id)).toBe("cancelled");

    const refunds = await prisma.refund.findMany();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      paymentId: payment.id,
      reason: "guest_cancel_full",
      amountKrw: booking.firstPaymentTotal,
      status: "pending",
      manual: false,
    });

    expect(email.sent.map((m) => m.to)).toEqual([guest.email, ...ADMINS]);
    expect(email.sent[0].subject).toBe("예약이 취소되었습니다 – 홍대 하우스 · 101호");
    expect(email.sent[1].subject).toBe("[운영] 예약 취소 – 홍대 하우스 · 101호");
    expect(email.sent[1].text).toContain(`https://app.test/admin/bookings/${booking.id}`);
    const logs = await prisma.emailLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.template)).toEqual(["booking_cancelled", "admin_booking_cancelled", "admin_booking_cancelled"]);
  });

  test("guestCancel after the deadline → deposit only; USD preview carries the proportional amount", async () => {
    const { booking, guest } = await confirmed({ moveIn: "2027-01-15", moveOut: "2027-02-15", currency: "USD" });
    const preview = await guestPreviewCancel(prisma, guest.id, booking.id, NOW);
    expect(preview).toMatchObject({ kind: "deposit_only", amountKrw: 500_000 });
    expect(preview!.payments[0].currency).toBe("USD");

    const r = await guestCancel(deps(), guest.id, booking.id, "deposit_only");
    expect(r).toMatchObject({ refundKrw: 500_000 });
    const refund = await prisma.refund.findFirstOrThrow();
    expect(refund.reason).toBe("guest_cancel_deposit_only");
    expect(refund.amountRefundedMinor).toBe(preview!.payments[0].refundMinor);
  });

  test("guestCancel refuses with REFUND_CHANGED when the refund kind changed since the preview", async () => {
    // Full-refund deadline: 2027-01-10 23:59:59 KST (move-in 2027-01-17).
    const { booking, guest } = await confirmed({ moveIn: "2027-01-17", moveOut: "2027-02-17" });
    const t1 = NOW; // 2027-01-10 12:00 KST, before the deadline
    const t2 = new Date("2027-01-10T15:30:00Z"); // 2027-01-11 00:30 KST, after it
    expect(await guestPreviewCancel(prisma, guest.id, booking.id, t1)).toMatchObject({ kind: "full" });

    const email = new MemoryEmailSender();
    const err = await guestCancel(deps(email, t2), guest.id, booking.id, "full").catch((e) => e);
    expect(guestBookingErrorKey(err)).toBe("REFUND_CHANGED");
    expect(await statusOf(booking.id)).toBe("confirmed");
    expect(await prisma.refund.count()).toBe(0);
    expect(email.sent).toEqual([]);
    expect(await prisma.emailLog.count()).toBe(0);

    expect(await guestPreviewCancel(prisma, guest.id, booking.id, t2)).toMatchObject({ kind: "deposit_only" });
    const r = await guestCancel(deps(email, t2), guest.id, booking.id, "deposit_only");
    expect(r).toMatchObject({ refundKrw: 500_000 });
    expect(await statusOf(booking.id)).toBe("cancelled");
    expect((await prisma.refund.findFirstOrThrow()).reason).toBe("guest_cancel_deposit_only");
  });

  test("guestCancel on move-in day → CANCEL_NOT_ALLOWED", async () => {
    const { booking, guest } = await confirmed({ moveIn: "2027-01-10", moveOut: "2027-02-10" });
    expect(await guestPreviewCancel(prisma, guest.id, booking.id, NOW)).toEqual({
      kind: "not_allowed",
      amountKrw: 0,
      payments: [],
    });
    const email = new MemoryEmailSender();
    const err = await guestCancel(deps(email), guest.id, booking.id, "full").catch((e) => e);
    expect(guestBookingErrorKey(err)).toBe("CANCEL_NOT_ALLOWED");
    expect(await statusOf(booking.id)).toBe("confirmed");
    expect(await prisma.refund.count()).toBe(0);
    expect(email.sent).toEqual([]);
  });

  test("guests cannot cancel an unpaid hold; preview is null for it", async () => {
    const { booking, guest } = await setup({ status: "awaiting_payment" });
    expect(await guestPreviewCancel(prisma, guest.id, booking.id, NOW)).toBeNull();
    const err = await guestCancel(deps(), guest.id, booking.id, "full").catch((e) => e);
    expect(guestBookingErrorKey(err)).toBe("INVALID_STATE");
    expect(await statusOf(booking.id)).toBe("awaiting_payment");
  });
});
