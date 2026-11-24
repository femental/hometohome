import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { Payment } from "@portone/server-sdk";
import { createPortOneClient, FakePortOne, portOneConfig, verifyPortOneWebhook, PortOneError } from "@/server/payments/portone";

const paid = (o: Record<string, unknown> = {}) => ({
  status: "PAID",
  id: "pay-1",
  transactionId: "tx-1",
  amount: { total: 1_300_000, cancelled: 0 },
  currency: "KRW",
  pgTxId: "pg-1",
  ...o,
});

function sdkWith(getPayment: (o: { paymentId: string }) => Promise<unknown>, cancelPayment = vi.fn()) {
  return { getPayment, cancelPayment } as never;
}

describe("getPayment", () => {
  test("maps a PAID KRW payment", async () => {
    const c = createPortOneClient(sdkWith(async () => paid()));
    expect(await c.getPayment("pay-1")).toMatchObject({
      id: "pay-1",
      status: "PAID",
      amount: { total: 1_300_000, cancelled: 0 },
      currency: "KRW",
      pgTxId: "pg-1",
    });
  });

  test("maps a USD payment in cents and partial cancellation", async () => {
    const c = createPortOneClient(
      sdkWith(async () => paid({ status: "PARTIAL_CANCELLED", currency: "USD", amount: { total: 96087, cancelled: 36957 } })),
    );
    expect(await c.getPayment("pay-1")).toMatchObject({ status: "PARTIAL_CANCELLED", currency: "USD", amount: { total: 96087, cancelled: 36957 } });
  });

  test("PAYMENT_NOT_FOUND → null", async () => {
    const notFound = new Payment.GetPaymentError({ type: "PAYMENT_NOT_FOUND" } as never);
    const c = createPortOneClient(sdkWith(async () => Promise.reject(notFound)));
    expect(await c.getPayment("nope")).toBeNull();
  });

  test("other failures throw PortOneError without leaking the secret", async () => {
    const c = createPortOneClient(sdkWith(async () => Promise.reject(new Error("401 secret=abc"))));
    const err = await c.getPayment("pay-1").catch((e) => e);
    expect(err).toBeInstanceOf(PortOneError);
    expect(String(err.message)).not.toContain("abc");
  });
});

describe("cancelPayment", () => {
  test("sends amount, reason and currentCancellableAmount; maps the result", async () => {
    const cancel = vi.fn(async () => ({ cancellation: { status: "SUCCEEDED", id: "c-1" } }));
    const c = createPortOneClient(sdkWith(async () => paid(), cancel));
    const r = await c.cancelPayment("pay-1", { amount: 500_000, reason: "guest cancel", currentCancellableAmount: 1_300_000 });
    expect(cancel).toHaveBeenCalledWith({
      paymentId: "pay-1",
      amount: 500_000,
      reason: "guest cancel",
      currentCancellableAmount: 1_300_000,
    });
    expect(r).toEqual({ status: "SUCCEEDED", cancellationId: "c-1" });
  });
});

describe("FakePortOne", () => {
  test("cancel reduces the cancellable amount and can be told to fail once", async () => {
    const pg = new FakePortOne();
    pg.payments.set("p", { id: "p", status: "PAID", amount: { total: 1000, cancelled: 0 }, currency: "KRW", raw: {} });
    pg.failNextCancel = true;
    await expect(pg.cancelPayment("p", { amount: 400, reason: "x", currentCancellableAmount: 1000 })).rejects.toBeInstanceOf(PortOneError);
    await pg.cancelPayment("p", { amount: 400, reason: "x", currentCancellableAmount: 1000 });
    expect(pg.payments.get("p")).toMatchObject({ status: "PARTIAL_CANCELLED", amount: { total: 1000, cancelled: 400 } });
    expect(pg.cancelCalls).toHaveLength(1);
  });
});

describe("portOneConfig fake mode", () => {
  test("only outside production and only without a real API secret", () => {
    expect(portOneConfig({ PORTONE_FAKE: "1", NODE_ENV: "development" }).fake).toBe(true);
    expect(portOneConfig({ PORTONE_FAKE: "1", NODE_ENV: "production" }).fake).toBe(false);
    expect(portOneConfig({ PORTONE_FAKE: "1", NODE_ENV: "development", PORTONE_API_SECRET: "real" }).fake).toBe(false);
  });
});

describe("verifyPortOneWebhook", () => {
  const key = randomBytes(24);
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "Transaction.Paid", timestamp: new Date().toISOString(), data: { paymentId: "pay-1", storeId: "s", transactionId: "t" } });
  const sign = (payload: string, ts = Math.floor(Date.now() / 1000)) => {
    const id = "msg_1";
    const sig = createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
    return new Headers({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` });
  };

  test("valid signature → type and paymentId", async () => {
    expect(await verifyPortOneWebhook(secret, body, sign(body))).toEqual({ type: "Transaction.Paid", paymentId: "pay-1" });
  });

  test("tampered body or missing headers → null", async () => {
    expect(await verifyPortOneWebhook(secret, body.replace("pay-1", "pay-2"), sign(body))).toBeNull();
    expect(await verifyPortOneWebhook(secret, body, new Headers())).toBeNull();
  });
});
