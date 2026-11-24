import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { MemoryEmailSender } from "@/server/email/sender";
import { FakePortOne } from "@/server/payments/portone";
import { createHmac, randomBytes } from "node:crypto";
import {
  cleanupStalePayments,
  completePayment,
  handlePortOneWebhook,
  preparePayment,
  PaymentFlowError,
  type PayDeps,
} from "@/server/payments/service";
import { makeBooking, makeGuest, makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const now = new Date("2027-03-01T03:00:00Z");
const HOUR = 3600_000;

function deps(o: Partial<PayDeps> = {}): PayDeps & { pg: FakePortOne; email: MemoryEmailSender } {
  return {
    db: prisma,
    pg: new FakePortOne(),
    email: new MemoryEmailSender(),
    now,
    appUrl: "http://localhost:3000",
    adminEmails: ["admin@example.com"],
    config: { storeId: "store-1", channelKeyCard: "ck-card", channelKeyPaypal: "ck-paypal", fake: false },
    getRate: async () => ({ rate: 1380, date: "2027-03-01", source: "cache" }),
    ...o,
  } as PayDeps & { pg: FakePortOne; email: MemoryEmailSender };
}

async function awaitingBooking(o: { holdExpiresAt?: Date; status?: "awaiting_payment" | "confirmed" } = {}) {
  const guest = await makeGuest(prisma);
  const room = await makeRoom(prisma);
  const b = await makeBooking(prisma, {
    roomId: room.id,
    guestId: guest.id,
    moveIn: "2027-03-15",
    moveOut: "2027-05-15",
    status: o.status ?? "awaiting_payment",
    holdExpiresAt: o.holdExpiresAt ?? new Date(now.getTime() + 20 * HOUR),
  });
  return { guest, room, booking: b };
}

/** The PG side of a successful checkout for a prepared payment row. */
function pgPaid(d: { pg: FakePortOne }, p: { paymentId: string; totalAmount: number; currency: string }, o: Partial<{ total: number; currency: string }> = {}) {
  d.pg.payments.set(p.paymentId, {
    id: p.paymentId,
    status: "PAID",
    amount: { total: o.total ?? p.totalAmount, cancelled: 0 },
    currency: o.currency ?? p.currency,
    pgTxId: "pg-tx-1",
    raw: {},
  });
}

describe("preparePayment", () => {
  test("card: KRW amount = firstPaymentTotal; pending row created", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    expect(p).toMatchObject({ storeId: "store-1", channelKey: "ck-card", currency: "KRW", totalAmount: 1_300_000 });
    expect(p.redirectUrl).toBe(`http://localhost:3000/en/bookings/${booking.id}/pay/complete?paymentId=${p.paymentId}`);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).toMatchObject({
      method: "card",
      currency: "KRW",
      amountKrw: 1_300_000,
      amountChargedMinor: 1_300_000,
      status: "pending",
    });
  });

  test("paypal: USD cents with 2% margin from the day's rate", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "paypal", "ko");
    // 1,300,000 / 1380 × 1.02 = 960.869… → 96087 cents
    expect(p).toMatchObject({ channelKey: "ck-paypal", currency: "USD", totalAmount: 96087, fx: { rate: 1380, date: "2027-03-01" } });
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } });
    expect(Number(row.fxRate)).toBe(1380);
  });

  test("paypal without a rate → FX_UNAVAILABLE; missing channel → CHANNEL_UNAVAILABLE", async () => {
    const { guest, booking } = await awaitingBooking();
    await expect(preparePayment(deps({ getRate: async () => null }), guest.id, booking.id, "paypal", "en")).rejects.toMatchObject({
      code: "FX_UNAVAILABLE",
    });
    const noCard = deps({ config: { storeId: "s", fake: false } });
    await expect(preparePayment(noCard, guest.id, booking.id, "card", "en")).rejects.toBeInstanceOf(PaymentFlowError);
    expect(await prisma.payment.count()).toBe(0);
  });

  test("refuses another guest's booking, a non-awaiting booking and an expired hold", async () => {
    const d = deps();
    const { booking } = await awaitingBooking();
    const other = await makeGuest(prisma, { email: "other@example.com" });
    await expect(preparePayment(d, other.id, booking.id, "card", "en")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const expired = await awaitingBooking({ holdExpiresAt: new Date(now.getTime() - 1) });
    await expect(preparePayment(d, expired.guest.id, expired.booking.id, "card", "en")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe("completePayment", () => {
  test("PAID → confirmed, booking_confirmed to guest and admin_payment_received to admins", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    expect(await completePayment(d, p.paymentId)).toEqual({ outcome: "confirmed", bookingId: booking.id });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("confirmed");
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).toMatchObject({ status: "paid", pgTxId: "pg-tx-1" });
    expect(d.email.sent.map((m) => m.to).sort()).toEqual(["admin@example.com", guest.email].sort());
  });

  test("redirect and webhook at once → one confirmation, one set of emails", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    const outcomes = await Promise.all([completePayment(d, p.paymentId), completePayment(d, p.paymentId)]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(["already_confirmed", "confirmed"]);
    expect(d.email.sent).toHaveLength(2);
  });

  test("PG amount or currency differs from the row → amount_mismatch, PG full cancel, not confirmed", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p, { total: 1000 });
    expect((await completePayment(d, p.paymentId)).outcome).toBe("amount_mismatch");
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).toMatchObject({ status: "failed" });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("awaiting_payment");
    expect(d.pg.cancelCalls).toEqual([expect.objectContaining({ paymentId: p.paymentId, amount: 1000 })]);
  });

  test("not paid at PG → not_paid; unknown id → unknown_payment", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    expect((await completePayment(d, p.paymentId)).outcome).toBe("unknown_payment");
    d.pg.payments.set(p.paymentId, { id: p.paymentId, status: "FAILED", amount: { total: 1_300_000, cancelled: 0 }, currency: "KRW", raw: {} });
    expect((await completePayment(d, p.paymentId)).outcome).toBe("not_paid");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).status).toBe("failed");
    expect((await completePayment(d, "00000000-0000-4000-8000-000000000000")).outcome).toBe("unknown_payment");
  });

  test("PAID after the hold expired → late_refunded with exactly one PG refund, repeat is idempotent", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    const late = deps({ pg: d.pg, email: d.email, now: new Date(now.getTime() + 21 * HOUR) });
    expect((await completePayment(late, p.paymentId)).outcome).toBe("late_refunded");
    expect((await completePayment(late, p.paymentId)).outcome).toBe("late_refunded");
    expect(d.pg.cancelCalls).toHaveLength(1);
    expect(d.pg.cancelCalls[0]).toMatchObject({ amount: 1_300_000 });
    const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: p.paymentId } });
    expect(refund).toMatchObject({ reason: "late_payment_auto", status: "done" });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).toMatchObject({ status: "refunded" });
    const templates = (await prisma.emailLog.findMany()).map((e) => e.template).sort();
    expect(templates).toEqual(["admin_late_payment_refund", "late_payment_refund"]);
  });

  test("late payment whose auto refund fails at the PG → operators get admin_refund_failed", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    d.pg.failNextCancel = true;
    const late = deps({ pg: d.pg, email: d.email, now: new Date(now.getTime() + 21 * HOUR) });
    expect((await completePayment(late, p.paymentId)).outcome).toBe("late_refunded");
    expect((await prisma.refund.findFirstOrThrow({ where: { paymentId: p.paymentId } })).status).toBe("failed");
    expect((await prisma.emailLog.findMany()).map((e) => e.template)).toEqual(["admin_refund_failed"]);
  });

  test("second payment on a confirmed booking → duplicate_refunded", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p1 = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p1);
    await completePayment(d, p1.paymentId);
    // A second checkout raced the first: prepared while the hold was still open.
    const p2row = await prisma.payment.create({
      data: { bookingId: booking.id, method: "card", currency: "KRW", amountKrw: 1_300_000, amountChargedMinor: 1_300_000, status: "pending" },
    });
    pgPaid(d, { paymentId: p2row.id, totalAmount: 1_300_000, currency: "KRW" });
    expect((await completePayment(d, p2row.id)).outcome).toBe("duplicate_refunded");
    expect(d.pg.cancelCalls.map((c) => c.paymentId)).toEqual([p2row.id]);
  });
});

describe("operational hardening", () => {
  test("PAID payment refused by confirmPaid → PG full cancel, payment failed, admin_payment_problem", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    // The booking's price changed under the payment (row amount no longer equals firstPaymentTotal).
    await prisma.booking.update({ where: { id: booking.id }, data: { firstPaymentTotal: 1_400_000 } });
    expect((await completePayment(d, p.paymentId)).outcome).toBe("refused");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).status).toBe("failed");
    expect(d.pg.cancelCalls).toEqual([expect.objectContaining({ paymentId: p.paymentId, amount: 1_300_000 })]);
    expect((await prisma.emailLog.findMany()).map((e) => e.template)).toEqual(["admin_payment_problem"]);
  });

  test("amount_mismatch emails operators", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p, { total: 1000 });
    expect((await completePayment(d, p.paymentId)).outcome).toBe("amount_mismatch");
    expect((await prisma.emailLog.findMany()).map((e) => e.template)).toEqual(["admin_payment_problem"]);
  });

  test("stale pending payments (24h) are cancelled; one the PG shows PAID is completed instead", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const abandoned = await preparePayment(d, guest.id, booking.id, "card", "en");
    const paidLate = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, paidLate);
    await prisma.payment.updateMany({ data: { createdAt: new Date(now.getTime() - 25 * 3600_000) } });
    const res = await cleanupStalePayments(d);
    expect(res).toEqual({ cancelled: 1, completed: 1 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: abandoned.paymentId } })).status).toBe("cancelled");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paidLate.paymentId } })).status).toBe("paid");
  });
});

describe("webhook", () => {
  const key = randomBytes(24);
  const secret = `whsec_${key.toString("base64")}`;
  const signed = (body: string) => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64");
    return new Headers({ "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` });
  };
  const eventBody = (type: string, paymentId: string) =>
    JSON.stringify({ type, timestamp: new Date().toISOString(), data: { paymentId, storeId: "s", transactionId: "t" } });

  test("bad signature → 401, nothing confirmed", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    expect(await handlePortOneWebhook(d, secret, eventBody("Transaction.Paid", p.paymentId), new Headers())).toBe(401);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("awaiting_payment");
  });

  test("valid Transaction.Paid → 200 and confirmed; other event types → 200 without action", async () => {
    const d = deps();
    const { guest, booking } = await awaitingBooking();
    const p = await preparePayment(d, guest.id, booking.id, "card", "en");
    pgPaid(d, p);
    const body = eventBody("Transaction.Paid", p.paymentId);
    expect(await handlePortOneWebhook(d, secret, body, signed(body))).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("confirmed");
    const ready = eventBody("Transaction.Ready", p.paymentId);
    expect(await handlePortOneWebhook(d, secret, ready, signed(ready))).toBe(200);
  });
});
