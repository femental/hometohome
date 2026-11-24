import { afterAll, beforeEach, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { cancelBooking } from "@/server/bookings/service";
import { adminMarkRefundDone, dashboardCounts } from "@/server/admin/bookings";
import { MemoryEmailSender } from "@/server/email/sender";
import { FakePortOne } from "@/server/payments/portone";
import { executeRefund, reconcileProcessingRefunds, runRefunds, type RefundNoticeDeps } from "@/server/payments/refunds";
import { makeBooking, makeGuest, makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const now = new Date("2027-03-05T03:00:00Z"); // before the 3/8 deadline for a 3/15 move-in

function deps(): RefundNoticeDeps & { pg: FakePortOne; email: MemoryEmailSender } {
  return {
    db: prisma,
    pg: new FakePortOne(),
    email: new MemoryEmailSender(),
    now,
    appUrl: "http://localhost:3000",
    adminEmails: ["admin@example.com"],
  };
}

/** A confirmed booking paid through the PG (KRW card by default) and registered with the fake PG. */
async function paidBooking(d: { pg: FakePortOne }, o: { currency?: "KRW" | "USD"; charged?: number; method?: "card" | "paypal" | "offline" } = {}) {
  const guest = await makeGuest(prisma);
  const room = await makeRoom(prisma);
  const b = await makeBooking(prisma, { roomId: room.id, guestId: guest.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status: "awaiting_payment" });
  const charged = o.charged ?? 1_300_000;
  const payment = await prisma.payment.create({
    data: {
      bookingId: b.id,
      method: o.method ?? "card",
      currency: o.currency ?? "KRW",
      amountKrw: 1_300_000,
      amountChargedMinor: charged,
      status: "paid",
      paidAt: now,
    },
  });
  await prisma.booking.update({ where: { id: b.id }, data: { status: "confirmed", confirmedPaymentId: payment.id } });
  d.pg.payments.set(payment.id, { id: payment.id, status: "PAID", amount: { total: charged, cancelled: 0 }, currency: o.currency ?? "KRW", raw: {} });
  return { guest, booking: b, payment };
}

test("guest full cancel (card) → PG cancel with won amount, refund done, payment refunded, refund_completed mail", async () => {
  const d = deps();
  const { booking, payment, guest } = await paidBooking(d);
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "guest", userId: guest.id }, now);
  expect(await runRefunds(d, refundIds)).toEqual(["done"]);
  expect(d.pg.cancelCalls).toEqual([expect.objectContaining({ paymentId: payment.id, amount: 1_300_000 })]);
  expect(await prisma.refund.findUniqueOrThrow({ where: { id: refundIds[0] } })).toMatchObject({ status: "done" });
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("refunded");
  expect(d.email.sent.map((m) => m.to)).toEqual([guest.email]);
  expect((await prisma.emailLog.findFirstOrThrow()).template).toBe("refund_completed");
});

test("paypal deposit-only refund cancels proportional cents and leaves the payment partially refunded", async () => {
  const d = deps();
  const { booking, payment, guest } = await paidBooking(d, { currency: "USD", charged: 96087, method: "paypal" });
  const after = new Date("2027-03-09T03:00:00Z"); // after the deadline → deposit only
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "guest", userId: guest.id }, after);
  await runRefunds({ ...d, now: after }, refundIds);
  expect(d.pg.cancelCalls[0]).toMatchObject({ paymentId: payment.id, amount: 36957 }); // 96087 × 5/13
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("partially_refunded");
});

test("PG failure → refund failed + admin_refund_failed; a retry then succeeds once", async () => {
  const d = deps();
  const { booking } = await paidBooking(d);
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "admin" }, now);
  d.pg.failNextCancel = true;
  expect(await runRefunds(d, refundIds)).toEqual(["failed"]);
  expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundIds[0] } })).status).toBe("failed");
  expect((await prisma.emailLog.findMany()).map((e) => e.template)).toEqual(["admin_refund_failed"]);
  expect(await runRefunds(d, refundIds)).toEqual(["done"]);
  expect(d.pg.cancelCalls).toHaveLength(1);
});

test("PG cancelled but the response was lost → retry does not refund twice and records done", async () => {
  const d = deps();
  const { booking, payment, guest } = await paidBooking(d);
  const after = new Date("2027-03-09T03:00:00Z"); // deposit only: a partial cancel the PG would accept twice
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "guest", userId: guest.id }, after);
  d.pg.loseNextCancelResponse = true;
  expect(await runRefunds({ ...d, now: after }, refundIds)).toEqual(["failed"]);
  expect(d.pg.payments.get(payment.id)?.amount.cancelled).toBe(500_000); // the PG did cancel

  expect(await runRefunds({ ...d, now: after }, refundIds)).toEqual(["done"]);
  expect(d.pg.payments.get(payment.id)?.amount.cancelled).toBe(500_000); // not cancelled again
  expect(await prisma.refund.findUniqueOrThrow({ where: { id: refundIds[0] } })).toMatchObject({ status: "done" });
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("partially_refunded");
});

test("a refund stuck in processing (crash after claim) can be retried safely", async () => {
  const d = deps();
  const { booking } = await paidBooking(d);
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "admin" }, now);
  await prisma.refund.update({ where: { id: refundIds[0] }, data: { status: "processing" } });
  expect(await executeRefund(d, refundIds[0])).toBe("skipped"); // automatic runs leave it alone
  expect(await executeRefund(d, refundIds[0], { includeStuck: true })).toBe("done"); // operator retry
  expect(d.pg.cancelCalls).toHaveLength(1);
});

test("dashboard counts PG refunds that failed", async () => {
  const d = deps();
  const { booking } = await paidBooking(d);
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "admin" }, now);
  d.pg.failNextCancel = true;
  await runRefunds(d, refundIds);
  expect((await dashboardCounts(prisma, now)).failedRefunds).toBe(1);
});

test("executing the same refund twice cancels at the PG once", async () => {
  const d = deps();
  const { booking } = await paidBooking(d);
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "admin" }, now);
  const [a, b] = await Promise.all([executeRefund(d, refundIds[0]), executeRefund(d, refundIds[0])]);
  expect([a, b].sort()).toEqual(["done", "skipped"]);
  expect(d.pg.cancelCalls).toHaveLength(1);
});

test("manual (offline) refund marked done sends refund_completed to the guest", async () => {
  const d = deps();
  const { booking, guest } = await paidBooking(d, { method: "offline" });
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "admin" }, now);
  expect(await runRefunds(d, refundIds)).toEqual(["skipped"]); // manual rows never go to the PG
  await adminMarkRefundDone(d, refundIds[0]);
  expect(d.pg.cancelCalls).toHaveLength(0);
  expect(d.email.sent.map((m) => m.to)).toEqual([guest.email]);
  expect((await prisma.emailLog.findFirstOrThrow()).template).toBe("refund_completed");
});

test("REQUESTED (async) cancellation stays processing until the PG shows it cancelled, then done + refund_completed", async () => {
  const d = deps();
  const { booking, payment, guest } = await paidBooking(d);
  const { refundIds } = await cancelBooking(prisma, booking.id, { kind: "guest", userId: guest.id }, now);
  d.pg.nextCancelStatus = "REQUESTED";
  expect(await runRefunds(d, refundIds)).toEqual(["processing"]);
  expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundIds[0] } })).status).toBe("processing");
  expect(d.email.sent).toHaveLength(0);

  // The PG finishes the cancellation later; reconciliation (webhook or daily job) records it.
  const later = { ...d, now: new Date(now.getTime() + 3600_000) };
  expect(await reconcileProcessingRefunds(later)).toEqual({ done: 1, stillPending: 0 });
  expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundIds[0] } })).status).toBe("done");
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("refunded");
  expect((await prisma.emailLog.findFirstOrThrow()).template).toBe("refund_completed");
});
