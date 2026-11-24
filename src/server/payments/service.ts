import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { effectiveStatus } from "@/domain/booking-status";
import { addDays, type ISODate } from "@/domain/dates";
import { DEFAULT_FX_MARGIN, quoteForeignMinor } from "@/domain/fx";
import { cancellationDeadline } from "@/domain/refund";
import { fromDbDate } from "@/server/bookings/availability";
import { BookingError } from "@/server/bookings/errors";
import { confirmPaid } from "@/server/bookings/service";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { EmailSender } from "@/server/email/sender";
import type { TemplateData, TemplateName } from "@/server/email/templates";
import type { UsdKrwRate } from "@/server/fx/rates";
import { verifyPortOneWebhook, type PortOneClient, type PortOneConfig } from "./portone";
import { executeRefund } from "./refunds";

export interface PayDeps {
  db: Db;
  pg: PortOneClient;
  email: EmailSender;
  now: Date;
  appUrl: string;
  adminEmails: string[];
  config: PortOneConfig;
  /** Today's USD→KRW rate (Task 2 `getUsdKrwRate`), injected so tests stay offline. */
  getRate: () => Promise<UsdKrwRate | null>;
}

export type PayMethod = "card" | "paypal";
type Locale = "en" | "ko";

/** Refusals of the payment flow that are not booking-domain rules. */
export class PaymentFlowError extends Error {
  constructor(readonly code: "CHANNEL_UNAVAILABLE" | "FX_UNAVAILABLE") {
    super(code);
    this.name = "PaymentFlowError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const withPlace = { room: { include: { house: true } } } satisfies Prisma.BookingInclude;
type BookingWithPlace = Prisma.BookingGetPayload<{ include: typeof withPlace & { guest: true } }>;

const pick = (n: unknown, locale: Locale) => {
  const o = n as { en: string; ko?: string };
  return (locale === "ko" && o.ko ? o.ko : undefined) ?? o.en;
};

export interface PreparedPayment {
  paymentId: string;
  storeId: string;
  channelKey: string;
  currency: "KRW" | "USD";
  /** Minor units of `currency` (KRW won, USD cents) — exactly what the server will verify. */
  totalAmount: number;
  orderName: string;
  customer: { email: string; fullName: string };
  redirectUrl: string;
  fx?: { rate: number; date: ISODate };
}

/**
 * Creates the pending Payment row a checkout will be verified against. Only the booking's own
 * guest, and only while the hold is live. The amount and currency come from the booking snapshot
 * (and today's rate for PayPal), never from the client.
 */
export async function preparePayment(
  d: PayDeps,
  userId: string,
  bookingId: string,
  method: PayMethod,
  locale: Locale,
): Promise<PreparedPayment> {
  if (!UUID.test(bookingId)) throw new BookingError("NOT_FOUND");
  const b = await d.db.booking.findUnique({ where: { id: bookingId }, include: { ...withPlace, guest: true } });
  if (!b || b.guestId !== userId) throw new BookingError("NOT_FOUND");
  if (effectiveStatus(b, d.now) !== "awaiting_payment") throw new BookingError("INVALID_STATE", "hold is not live");

  // Dev fake mode needs no PortOne account: placeholder ids, the fake PG never sees them.
  const channelKey =
    (method === "card" ? d.config.channelKeyCard : d.config.channelKeyPaypal) ?? (d.config.fake ? `fake-${method}` : undefined);
  const storeId = d.config.storeId ?? (d.config.fake ? "fake-store" : undefined);
  if (!storeId || !channelKey) throw new PaymentFlowError("CHANNEL_UNAVAILABLE");

  let currency: "KRW" | "USD" = "KRW";
  let totalAmount = b.firstPaymentTotal;
  let fx: PreparedPayment["fx"];
  if (method === "paypal") {
    const rate = await d.getRate();
    if (!rate) throw new PaymentFlowError("FX_UNAVAILABLE");
    currency = "USD";
    totalAmount = quoteForeignMinor(b.firstPaymentTotal, rate.rate, DEFAULT_FX_MARGIN);
    fx = { rate: rate.rate, date: rate.date };
  }

  const row = await d.db.payment.create({
    data: {
      bookingId: b.id,
      method,
      currency,
      amountKrw: b.firstPaymentTotal,
      amountChargedMinor: totalAmount,
      fxRate: fx?.rate,
      fxQuotedAt: fx ? d.now : undefined,
      status: "pending",
    },
  });

  return {
    paymentId: row.id,
    storeId,
    channelKey,
    currency,
    totalAmount,
    orderName: `${pick(b.room.house.name, "en")} – ${pick(b.room.name, "en")}`.slice(0, 80),
    customer: { email: b.guest.email, fullName: b.guestName },
    redirectUrl: `${d.appUrl}/${locale}/bookings/${b.id}/pay/complete?paymentId=${row.id}`,
    fx,
  };
}

export type CompleteOutcome =
  | "confirmed"
  | "already_confirmed"
  | "late_refunded"
  | "duplicate_refunded"
  | "not_paid"
  | "amount_mismatch"
  | "unknown_payment";

// ---------------------------------------------------------------------------
// Emails (after commit; failures never change the result)

function emailData(b: BookingWithPlace, locale: Locale, extra: Partial<TemplateData> = {}): TemplateData {
  return {
    guestName: b.guestName,
    houseName: pick(b.room.house.name, locale),
    roomName: pick(b.room.name, locale),
    moveIn: fromDbDate(b.moveIn),
    lastNight: addDays(fromDbDate(b.moveOut), -1),
    firstPaymentTotal: b.firstPaymentTotal,
    deposit: b.deposit,
    cancellationDeadline: cancellationDeadline(fromDbDate(b.moveIn)),
    ...extra,
  };
}

async function notify(
  d: PayDeps,
  bookingId: string,
  guest: { template: TemplateName; extra?: (locale: Locale) => Partial<TemplateData> } | null,
  admin: { template: TemplateName; extra?: Partial<TemplateData> } | null,
) {
  try {
    const b = await d.db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { ...withPlace, guest: true } });
    if (guest) {
      const locale: Locale = b.guest.locale === "ko" ? "ko" : "en";
      await sendEmail(d.db, d.email, {
        to: b.guest.email,
        template: guest.template,
        locale,
        data: emailData(b, locale, guest.extra?.(locale)),
        bookingId: b.id,
      });
    }
    if (admin) {
      for (const to of d.adminEmails) {
        await sendEmail(d.db, d.email, {
          to,
          template: admin.template,
          locale: "ko",
          data: emailData(b, "ko", { bookingUrl: `${d.appUrl}/admin/bookings/${b.id}`, ...admin.extra }),
          bookingId: b.id,
        });
      }
    }
  } catch (e) {
    console.error("[payments] notification failed", e);
  }
}

/**
 * Verifies a checkout with the PG and confirms the booking. Idempotent: the client redirect and the
 * PortOne webhook both call it, in any order or at once. Only the PG's own record (status, amount,
 * currency) is trusted.
 */
export async function completePayment(
  d: PayDeps,
  paymentId: string,
): Promise<{ outcome: CompleteOutcome; bookingId?: string }> {
  if (!UUID.test(paymentId)) return { outcome: "unknown_payment" };
  const row = await d.db.payment.findUnique({ where: { id: paymentId } });
  if (!row || row.method === "offline") return { outcome: "unknown_payment" };
  const bookingId = row.bookingId;

  if (row.status === "pending" || row.status === "failed") {
    const pg = await d.pg.getPayment(paymentId);
    if (!pg) return { outcome: "unknown_payment", bookingId };
    if (pg.status !== "PAID") {
      if (pg.status === "FAILED") await d.db.payment.updateMany({ where: { id: paymentId, status: "pending" }, data: { status: "failed" } });
      return { outcome: "not_paid", bookingId };
    }
    if (pg.amount.total !== row.amountChargedMinor || pg.currency !== row.currency) {
      await d.db.payment.update({ where: { id: paymentId }, data: { status: "failed", raw: pg.raw as Prisma.InputJsonValue } });
      try {
        await d.pg.cancelPayment(paymentId, {
          amount: pg.amount.total - pg.amount.cancelled,
          reason: "Amount does not match the booking",
          currentCancellableAmount: pg.amount.total - pg.amount.cancelled,
        });
      } catch (e) {
        console.error(`[payments] could not cancel mismatched payment ${paymentId}`, e);
      }
      console.error(`[payments] amount mismatch on ${paymentId}: PG ${pg.amount.total} ${pg.currency}, expected ${row.amountChargedMinor} ${row.currency}`);
      return { outcome: "amount_mismatch", bookingId };
    }
    await d.db.payment.updateMany({
      where: { id: paymentId, status: { in: ["pending", "failed"] } },
      data: { status: "paid", pgTxId: pg.pgTxId ?? null, raw: pg.raw as Prisma.InputJsonValue, paidAt: d.now },
    });
  }

  const res = await confirmPaid(d.db, bookingId, paymentId, d.now);
  switch (res.result) {
    case "confirmed": {
      await notify(
        d,
        bookingId,
        {
          template: "booking_confirmed",
          extra: (locale) => ({ bookingUrl: `${d.appUrl}/${locale}/bookings/${bookingId}` }),
        },
        { template: "admin_payment_received" },
      );
      return { outcome: "confirmed", bookingId };
    }
    case "already_confirmed":
      return { outcome: "already_confirmed", bookingId };
    case "late_payment":
    case "duplicate_payment": {
      const executed = await executeRefund(d, res.refundId);
      if (executed === "done") {
        const refund = await d.db.refund.findUniqueOrThrow({ where: { id: res.refundId } });
        await notify(
          d,
          bookingId,
          { template: "late_payment_refund", extra: () => ({ refundKrw: refund.amountKrw }) },
          { template: "admin_late_payment_refund", extra: { refundKrw: refund.amountKrw } },
        );
      }
      return { outcome: res.result === "late_payment" ? "late_refunded" : "duplicate_refunded", bookingId };
    }
  }
}

/** Transaction events whose payment state the server re-reads from the PG. */
const SYNC_EVENTS = new Set(["Transaction.Paid", "Transaction.Failed", "Transaction.Cancelled", "Transaction.PartialCancelled"]);

/**
 * PortOne webhook: verifies the signature on the raw body, then lets `completePayment` re-read the
 * payment from the PG (the webhook body is never trusted for amounts). Returns the HTTP status:
 * 401 bad signature, 500 on a processing error (PortOne retries), else 200.
 */
export async function handlePortOneWebhook(d: PayDeps, secret: string, rawBody: string, headers: Headers): Promise<number> {
  const hook = await verifyPortOneWebhook(secret, rawBody, headers);
  if (!hook) return 401;
  if (!hook.paymentId || !SYNC_EVENTS.has(hook.type)) return 200;
  try {
    await completePayment(d, hook.paymentId);
    return 200;
  } catch (e) {
    console.error(`[payments] webhook ${hook.type} for ${hook.paymentId} failed`, e);
    return 500;
  }
}
