import "server-only";
import { Payment, PaymentClient, Webhook } from "@portone/server-sdk";

export type PgCurrency = "KRW" | "USD";
export type PgStatus =
  | "READY"
  | "PAID"
  | "FAILED"
  | "CANCELLED"
  | "PARTIAL_CANCELLED"
  | "VIRTUAL_ACCOUNT_ISSUED"
  | "PAY_PENDING";

/** A payment as the PG reports it; amounts in minor units of `currency` (KRW won, USD cents). */
export interface PgPayment {
  id: string;
  status: PgStatus;
  amount: { total: number; cancelled: number };
  currency: string;
  pgTxId?: string;
  raw: unknown;
}

export interface PgCancelResult {
  status: "SUCCEEDED" | "REQUESTED" | "FAILED";
  cancellationId: string;
}

export interface PortOneClient {
  /** null when the PG has no such payment. */
  getPayment(paymentId: string): Promise<PgPayment | null>;
  cancelPayment(
    paymentId: string,
    a: { amount: number; reason: string; currentCancellableAmount: number },
  ): Promise<PgCancelResult>;
}

/** A PG call that failed; the message never carries the API secret or the raw upstream error. */
export class PortOneError extends Error {
  constructor(
    readonly operation: "getPayment" | "cancelPayment",
    readonly kind: string,
  ) {
    super(`PortOne ${operation} failed (${kind})`);
    this.name = "PortOneError";
  }
}

type SdkPaymentClient = Pick<PaymentClient, "getPayment" | "cancelPayment">;

function errorKind(e: unknown): string {
  const data = (e as { data?: { type?: unknown } })?.data;
  return typeof data?.type === "string" ? data.type : "UNKNOWN";
}

/** Wraps the official SDK client (`PaymentClient({ secret })`); pass a fake SDK object in tests. */
export function createPortOneClient(sdk: SdkPaymentClient): PortOneClient {
  return {
    async getPayment(paymentId) {
      let p: Awaited<ReturnType<SdkPaymentClient["getPayment"]>>;
      try {
        p = await sdk.getPayment({ paymentId });
      } catch (e) {
        if (e instanceof Payment.GetPaymentError && errorKind(e) === "PAYMENT_NOT_FOUND") return null;
        throw new PortOneError("getPayment", errorKind(e));
      }
      const any = p as unknown as {
        status: PgStatus;
        id: string;
        amount?: { total?: number; cancelled?: number };
        currency?: string;
        pgTxId?: string;
      };
      return {
        id: any.id,
        status: any.status,
        amount: { total: any.amount?.total ?? 0, cancelled: any.amount?.cancelled ?? 0 },
        currency: any.currency ?? "",
        pgTxId: any.pgTxId,
        raw: p,
      };
    },

    async cancelPayment(paymentId, a) {
      try {
        const res = await sdk.cancelPayment({
          paymentId,
          amount: a.amount,
          reason: a.reason,
          currentCancellableAmount: a.currentCancellableAmount,
        });
        const c = res.cancellation as unknown as { status: string; id: string };
        const status = c.status === "SUCCEEDED" || c.status === "REQUESTED" ? c.status : "FAILED";
        return { status, cancellationId: c.id };
      } catch (e) {
        throw new PortOneError("cancelPayment", errorKind(e));
      }
    },
  };
}

/** In-memory PG for tests and the dev-only fake checkout (`PORTONE_FAKE=1`). */
export class FakePortOne implements PortOneClient {
  payments = new Map<string, PgPayment>();
  cancelCalls: { paymentId: string; amount: number; reason: string }[] = [];
  failNextCancel = false;

  async getPayment(paymentId: string): Promise<PgPayment | null> {
    const p = this.payments.get(paymentId);
    return p ? structuredClone(p) : null;
  }

  async cancelPayment(paymentId: string, a: { amount: number; reason: string; currentCancellableAmount: number }) {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new PortOneError("cancelPayment", "FAKE_FAILURE");
    }
    const p = this.payments.get(paymentId);
    if (!p) throw new PortOneError("cancelPayment", "PAYMENT_NOT_FOUND");
    const cancellable = p.amount.total - p.amount.cancelled;
    if (a.currentCancellableAmount !== cancellable || a.amount > cancellable) {
      throw new PortOneError("cancelPayment", "CANCELLABLE_AMOUNT_CONSISTENCY_BROKEN");
    }
    this.cancelCalls.push({ paymentId, amount: a.amount, reason: a.reason });
    p.amount.cancelled += a.amount;
    p.status = p.amount.cancelled === p.amount.total ? "CANCELLED" : "PARTIAL_CANCELLED";
    return { status: "SUCCEEDED" as const, cancellationId: `fake-cancel-${this.cancelCalls.length}` };
  }
}

/** Verifies a PortOne (Standard Webhooks) request; null when the signature or headers are bad. */
export async function verifyPortOneWebhook(
  secret: string,
  rawBody: string,
  headers: Headers,
): Promise<{ type: string; paymentId?: string } | null> {
  const h: Record<string, string> = {};
  headers.forEach((v, k) => (h[k] = v));
  try {
    const hook = (await Webhook.verify(secret, rawBody, h)) as { type?: unknown; data?: { paymentId?: unknown } };
    if (typeof hook.type !== "string") return null;
    const paymentId = typeof hook.data?.paymentId === "string" ? hook.data.paymentId : undefined;
    return paymentId ? { type: hook.type, paymentId } : { type: hook.type };
  } catch {
    return null;
  }
}

export interface PortOneConfig {
  storeId?: string;
  channelKeyCard?: string;
  channelKeyPaypal?: string;
  apiSecret?: string;
  webhookSecret?: string;
  /** Dev-only in-memory PG (ignored in production). */
  fake: boolean;
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function portOneConfig(env: Record<string, string | undefined> = process.env): PortOneConfig {
  return {
    storeId: blank(env.NEXT_PUBLIC_PORTONE_STORE_ID),
    channelKeyCard: blank(env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_CARD),
    channelKeyPaypal: blank(env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_PAYPAL),
    apiSecret: blank(env.PORTONE_API_SECRET),
    webhookSecret: blank(env.PORTONE_WEBHOOK_SECRET),
    fake: env.PORTONE_FAKE === "1" && env.NODE_ENV !== "production",
  };
}

let fakeSingleton: FakePortOne | undefined;

/** The PG client for this process: the shared fake in dev fake mode, else the real SDK client, else null. */
export function defaultPortOneClient(cfg: PortOneConfig = portOneConfig()): PortOneClient | null {
  if (cfg.fake) return (fakeSingleton ??= new FakePortOne());
  if (!cfg.apiSecret) return null;
  return createPortOneClient(PaymentClient({ secret: cfg.apiSecret }));
}
