import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { BookingError } from "@/server/bookings/errors";
import { cancelBooking } from "@/server/bookings/service";
import { MemoryEmailSender } from "@/server/email/sender";
import {
  adminApprove,
  adminCancel,
  adminComplete,
  adminConfirmOffline,
  adminDepositReturned,
  adminMarkRefundDone,
  adminReject,
  dashboardCounts,
  getBookingDetail,
  listBookings,
  listRequests,
  type Deps,
} from "@/server/admin/bookings";
import { previewCancellation } from "@/server/bookings/refunds";
import { makeBooking, makeGuest, makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const NOW = new Date("2027-01-10T03:00:00Z"); // 12:00 KST
const APP_URL = "https://app.test";
const ADMINS = ["a1@example.com", "a2@example.com"];

function deps(email = new MemoryEmailSender(), now = NOW): Deps & { email: MemoryEmailSender } {
  return { db: prisma, email, now, appUrl: APP_URL, adminEmails: ADMINS };
}

const future = (h: number) => new Date(NOW.getTime() + h * 3600_000);

async function setup(
  opts: {
    locale?: string;
    status?: "requested" | "awaiting_payment" | "confirmed";
    moveIn?: string;
    moveOut?: string;
    roomId?: string;
  } = {},
) {
  const guest = await makeGuest(prisma, { locale: opts.locale ?? "en", name: "Gina" });
  const room = opts.roomId
    ? { id: opts.roomId }
    : await makeRoom(
        prisma,
        { name: { en: "Room 101", ko: "101호" } },
        { name: { en: "Hongdae House", ko: "홍대 하우스" } },
      );
  const status = opts.status ?? "requested";
  const booking = await makeBooking(prisma, {
    roomId: room.id,
    guestId: guest.id,
    moveIn: opts.moveIn ?? "2027-02-01",
    moveOut: opts.moveOut ?? "2027-03-01",
    status,
    requestExpiresAt: status === "requested" ? future(40) : null,
    holdExpiresAt: status === "awaiting_payment" ? future(10) : null,
  });
  return { guest, room, booking };
}

async function confirmedWithPayment(
  method: "card" | "offline",
  currency: "KRW" | "USD" = "KRW",
  moveIn = "2027-03-01",
  moveOut = "2027-04-01",
) {
  const { booking, guest, room } = await setup({ status: "confirmed", moveIn, moveOut });
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      method,
      currency,
      amountKrw: booking.firstPaymentTotal,
      amountChargedMinor: currency === "USD" ? 123_457 : booking.firstPaymentTotal,
      fxRate: currency === "USD" ? "1350.1234" : null,
      status: "paid",
      paidAt: NOW,
    },
  });
  await prisma.booking.update({ where: { id: booking.id }, data: { confirmedPaymentId: payment.id } });
  return { booking, guest, room, payment };
}

describe("approve / reject", () => {
  test("adminApprove sends request_approved with KST deadline and locale pay URL", async () => {
    const { booking } = await setup({ locale: "ko" });
    const d = deps();
    const b = await adminApprove(d, booking.id);
    expect(b.status).toBe("awaiting_payment");
    expect(d.email.sent).toHaveLength(1);
    const m = d.email.sent[0];
    expect(m.subject).toContain("2027-01-11 12:00 (KST)");
    expect(m.text).toContain(`${APP_URL}/ko/bookings/${booking.id}/pay`);
    expect(m.text).toContain("홍대 하우스");
    const logs = await prisma.emailLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "sent", template: "request_approved", bookingId: booking.id });
  });

  test("adminApprove uses English names for English guest", async () => {
    const { booking } = await setup({ locale: "en" });
    const d = deps();
    await adminApprove(d, booking.id);
    expect(d.email.sent[0].text).toContain("/en/bookings/");
    expect(d.email.sent[0].text).toContain("Hongdae House");
  });

  test("adminApprove still succeeds when email fails", async () => {
    const { booking } = await setup();
    const sender = new MemoryEmailSender();
    sender.failNext = true;
    const b = await adminApprove(deps(sender), booking.id);
    expect(b.status).toBe("awaiting_payment");
    const [log] = await prisma.emailLog.findMany();
    expect(log.status).toBe("failed");
  });

  test("adminApprove on overlapping confirmed → ROOM_UNAVAILABLE and no email", async () => {
    const first = await setup({ status: "confirmed" });
    const second = await setup({ roomId: first.room.id });
    const d = deps();
    await expect(adminApprove(d, second.booking.id)).rejects.toMatchObject({ code: "ROOM_UNAVAILABLE" });
    expect(d.email.sent).toHaveLength(0);
    expect(await prisma.emailLog.count()).toBe(0);
  });

  test("adminReject sends request_rejected with reason", async () => {
    const { booking } = await setup({ locale: "ko" });
    const d = deps();
    const b = await adminReject(d, booking.id, "일정 충돌");
    expect(b.status).toBe("rejected");
    expect(d.email.sent).toHaveLength(1);
    expect(d.email.sent[0].text).toContain("일정 충돌");
    expect(await prisma.emailLog.findMany({ where: { template: "request_rejected" } })).toHaveLength(1);
  });

  test("adminReject on invalid state throws and sends nothing", async () => {
    const { booking } = await setup({ status: "confirmed" });
    const d = deps();
    await expect(adminReject(d, booking.id, "x")).rejects.toBeInstanceOf(BookingError);
    expect(d.email.sent).toHaveLength(0);
  });
});

describe("offline confirmation", () => {
  test("adminConfirmOffline confirms, emails guest and auto-rejected applicants", async () => {
    const a = await setup({ status: "awaiting_payment", locale: "en" });
    const rival1 = await setup({ roomId: a.room.id, locale: "ko", moveIn: "2027-02-15", moveOut: "2027-03-15" });
    const rival2 = await setup({ roomId: a.room.id, locale: "en", moveIn: "2027-02-10", moveOut: "2027-03-10" });
    const d = deps();
    const r = await adminConfirmOffline(d, a.booking.id, {
      method: "bank_transfer",
      amountKrw: a.booking.firstPaymentTotal,
      note: "n",
    });
    expect([...r.autoRejectedIds].sort()).toEqual([rival1.booking.id, rival2.booking.id].sort());
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a.booking.id } })).status).toBe("confirmed");
    expect(d.email.sent).toHaveLength(3);
    const byTo = (to: string) => d.email.sent.find((m) => m.to === to)!;
    expect(byTo(a.guest.email).subject).toContain("Booking confirmed");
    expect(byTo(a.guest.email).text).toContain("Full refund if cancelled by");
    expect(byTo(a.guest.email).text).toContain("₩500,000");
    expect(byTo(rival1.guest.email).text).toContain("다른 신청이 확정되었습니다");
    expect(byTo(rival2.guest.email).text).toContain("Another request for these dates was confirmed");
  });

  test("adminConfirmOffline with wrong amount throws and sends nothing", async () => {
    const a = await setup({ status: "awaiting_payment" });
    const d = deps();
    await expect(
      adminConfirmOffline(d, a.booking.id, { method: "cash", amountKrw: 1, note: "" }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    expect(d.email.sent).toHaveLength(0);
  });
});

describe("cancellation", () => {
  test("previewCancellation matches cancelBooking amounts and writes nothing", async () => {
    const { booking } = await confirmedWithPayment("card", "USD");
    const preview = await previewCancellation(prisma, booking.id, { kind: "admin" }, NOW);
    expect(preview.kind).toBe("full");
    expect(preview.payments).toHaveLength(1);
    expect(await prisma.refund.count()).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("confirmed");

    const res = await cancelBooking(prisma, booking.id, { kind: "admin" }, NOW);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: res.refundIds[0] } });
    expect(preview.amountKrw).toBe(res.refund.amountKrw);
    expect(preview.payments[0]).toEqual({
      method: "card",
      currency: "USD",
      refundMinor: refund.amountRefundedMinor,
    });
  });

  test("previewCancellation for guest after deadline is deposit_only with proportional minor", async () => {
    const { booking, guest } = await confirmedWithPayment("card", "USD", "2027-01-15", "2027-02-15");
    const actor = { kind: "guest", userId: guest.id } as const;
    const p = await previewCancellation(prisma, booking.id, actor, NOW);
    expect(p.kind).toBe("deposit_only");
    const res = await cancelBooking(prisma, booking.id, actor, NOW);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: res.refundIds[0] } });
    expect(p.payments[0].refundMinor).toBe(refund.amountRefundedMinor);
  });

  test("previewCancellation for awaiting_payment by admin → not_allowed, no payments", async () => {
    const { booking } = await setup({ status: "awaiting_payment" });
    expect(await previewCancellation(prisma, booking.id, { kind: "admin" }, NOW)).toEqual({
      kind: "not_allowed",
      amountKrw: 0,
      payments: [],
    });
  });

  test("previewCancellation rejects other states", async () => {
    const { booking } = await setup();
    await expect(previewCancellation(prisma, booking.id, { kind: "admin" }, NOW)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("adminCancel on confirmed before deadline → full refund rows, guest+admin emails", async () => {
    const { booking, guest } = await confirmedWithPayment("offline");
    const d = deps();
    const r = await adminCancel(d, booking.id);
    expect(r.refundIds).toHaveLength(1);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: r.refundIds[0] } });
    expect(refund).toMatchObject({ amountKrw: booking.firstPaymentTotal, manual: true, status: "pending" });
    expect(d.email.sent).toHaveLength(1 + ADMINS.length);
    expect(d.email.sent.find((m) => m.to === guest.email)!.subject).toContain("cancelled");
    for (const a of ADMINS) expect(d.email.sent.find((m) => m.to === a)!.subject).toContain("[운영]");
  });

  test("adminCancel on awaiting_payment → no refund, emails still sent", async () => {
    const { booking } = await setup({ status: "awaiting_payment" });
    const d = deps();
    const r = await adminCancel(d, booking.id);
    expect(r.refundIds).toEqual([]);
    expect(d.email.sent).toHaveLength(1 + ADMINS.length);
  });

  test("adminCancel failure sends no email", async () => {
    const { booking } = await setup();
    const d = deps();
    await expect(adminCancel(d, booking.id)).rejects.toBeInstanceOf(BookingError);
    expect(d.email.sent).toHaveLength(0);
  });
});

describe("refund and completion marks", () => {
  test("adminMarkRefundDone only for manual pending refunds", async () => {
    const { payment } = await confirmedWithPayment("offline");
    const base = { paymentId: payment.id, reason: "admin_cancel", amountKrw: 1, amountRefundedMinor: 1 } as const;
    const manual = await prisma.refund.create({ data: { ...base, manual: true } });
    const auto = await prisma.refund.create({ data: { ...base, manual: false } });
    await expect(adminMarkRefundDone(prisma, auto.id, "n", NOW)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const done = await adminMarkRefundDone(prisma, manual.id, "sent", NOW);
    expect(done.status).toBe("done");
    await expect(adminMarkRefundDone(prisma, manual.id, "again", NOW)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(
      adminMarkRefundDone(prisma, "00000000-0000-0000-0000-000000000000", "n", NOW),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  test("adminComplete and adminDepositReturned delegate", async () => {
    const { booking } = await setup({ status: "confirmed", moveIn: "2027-01-05", moveOut: "2027-02-05" });
    expect((await adminComplete(prisma, booking.id, NOW)).status).toBe("completed");
    const b = await adminDepositReturned(prisma, booking.id, "bank", NOW);
    expect(b.depositReturnNote).toBe("bank");
  });
});

describe("queries", () => {
  test("listRequests hides expired requests; ordered by requestExpiresAt", async () => {
    const live1 = await setup();
    const live2 = await setup();
    await prisma.booking.update({ where: { id: live1.booking.id }, data: { requestExpiresAt: future(30) } });
    await prisma.booking.update({ where: { id: live2.booking.id }, data: { requestExpiresAt: future(5) } });
    const stale = await setup();
    await prisma.booking.update({ where: { id: stale.booking.id }, data: { requestExpiresAt: future(-1) } });
    await setup({ status: "awaiting_payment" });
    const rows = await listRequests(prisma, NOW);
    expect(rows.map((r) => r.id)).toEqual([live2.booking.id, live1.booking.id]);
    expect(rows[0]).toMatchObject({
      status: "requested",
      guestName: "Test Guest",
      guestEmail: live2.guest.email,
      houseName: "홍대 하우스",
      roomName: "101호",
      moveIn: "2027-02-01",
      lastNight: "2027-02-28",
    });
  });

  test("listBookings filters by status (effective), room and dates", async () => {
    const a = await setup({ status: "awaiting_payment" });
    // stored awaiting_payment, effectively payment_expired
    await prisma.booking.update({ where: { id: a.booking.id }, data: { holdExpiresAt: future(-1) } });
    const b = await setup({ status: "confirmed", moveIn: "2027-05-01", moveOut: "2027-06-01" });
    expect((await listBookings(prisma, { status: ["payment_expired"] }, NOW)).map((r) => r.id)).toEqual([
      a.booking.id,
    ]);
    expect(await listBookings(prisma, { status: ["awaiting_payment"] }, NOW)).toHaveLength(0);
    expect((await listBookings(prisma, { roomId: b.room.id }, NOW)).map((r) => r.id)).toEqual([b.booking.id]);
    expect(
      (await listBookings(prisma, { from: "2027-04-01", to: "2027-05-31" }, NOW)).map((r) => r.id),
    ).toEqual([b.booking.id]);
    expect(await listBookings(prisma, {}, NOW)).toHaveLength(2);
  });

  test("listBookings status=payment_expired returns stored awaiting_payment with expired hold, not live ones", async () => {
    const stale = await setup({ status: "awaiting_payment" });
    await prisma.booking.update({ where: { id: stale.booking.id }, data: { holdExpiresAt: future(-1) } });
    await setup({ status: "awaiting_payment" }); // hold still live
    await setup({ status: "requested" });
    const rows = await listBookings(prisma, { status: ["payment_expired"] }, NOW);
    expect(rows.map((r) => r.id)).toEqual([stale.booking.id]);
    expect(rows[0].status).toBe("payment_expired");
  });

  test("listBookings caps at 200 rows, newest move-in first", async () => {
    const guest = await makeGuest(prisma, {});
    const room = await makeRoom(prisma, {}, {});
    const base = await makeBooking(prisma, {
      roomId: room.id,
      guestId: guest.id,
      moveIn: "2027-02-01",
      moveOut: "2027-03-01",
      status: "cancelled",
    });
    const { id: _id, ...tpl } = base;
    void _id;
    await prisma.booking.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        ...tpl,
        moveIn: new Date(Date.UTC(2028, 0, 1 + i)),
        moveOut: new Date(Date.UTC(2028, 0, 2 + i)),
      })),
    });
    const rows = await listBookings(prisma, {}, NOW);
    expect(rows).toHaveLength(200);
    expect(rows[0].moveIn).toBe("2028-07-18");
    expect(rows.some((r) => r.id === base.id)).toBe(false);
  });

  test("getBookingDetail returns serializable detail with payments, refunds, logs", async () => {
    const { booking, payment } = await confirmedWithPayment("card", "USD");
    await prisma.refund.create({
      data: { paymentId: payment.id, reason: "admin_cancel", amountKrw: 1, amountRefundedMinor: 1 },
    });
    await prisma.emailLog.create({ data: { toEmail: "x@example.com", template: "t", bookingId: booking.id } });
    const detail = await getBookingDetail(prisma, booking.id, NOW);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe("confirmed");
    expect(detail!.lastNight).toBe("2027-03-31");
    expect(detail!.payments[0].fxRate).toBe("1350.1234");
    expect(detail!.payments[0].refunds).toHaveLength(1);
    expect(detail!.emailLogs).toHaveLength(1);
    expect(detail!.house.name).toBe("홍대 하우스");
    expect(() => structuredClone(detail)).not.toThrow();
    expect(JSON.parse(JSON.stringify(detail)).payments[0].fxRate).toBe("1350.1234");
    expect(await getBookingDetail(prisma, "00000000-0000-0000-0000-000000000000", NOW)).toBeNull();
  });

  test("dashboardCounts uses KST month boundaries", async () => {
    const kstApril = new Date("2027-03-31T15:30:00Z"); // 2027-04-01 00:30 KST
    await setup({ status: "confirmed", moveIn: "2027-04-01", moveOut: "2027-05-01" }); // move-in only (move-out is May 1)
    await setup({ status: "confirmed", moveIn: "2027-03-01", moveOut: "2027-04-01" }); // move-out only (April 1 KST)
    await setup({ status: "confirmed", moveIn: "2027-04-30", moveOut: "2027-05-30" }); // move-in only
    const r1 = await setup({ status: "requested" });
    await prisma.booking.update({
      where: { id: r1.booking.id },
      data: { requestExpiresAt: new Date(kstApril.getTime() + 3600_000) },
    });
    const r2 = await setup({ status: "requested" });
    await prisma.booking.update({
      where: { id: r2.booking.id },
      data: { requestExpiresAt: new Date(kstApril.getTime() - 3600_000) },
    });
    const w = await setup({ status: "awaiting_payment" });
    await prisma.booking.update({
      where: { id: w.booking.id },
      data: { holdExpiresAt: new Date(kstApril.getTime() + 3600_000) },
    });
    const { payment } = await confirmedWithPayment("offline", "KRW", "2027-08-01", "2027-09-01");
    const base = { paymentId: payment.id, reason: "admin_cancel", amountKrw: 1, amountRefundedMinor: 1, manual: true } as const;
    await prisma.refund.create({ data: base });
    await prisma.refund.create({ data: { ...base, status: "done" } });
    expect(await dashboardCounts(prisma, kstApril)).toEqual({
      pendingRequests: 1,
      awaitingPayment: 1,
      moveInsThisMonth: 2,
      moveOutsThisMonth: 1,
      manualRefundsPending: 1,
    });
  });
});
