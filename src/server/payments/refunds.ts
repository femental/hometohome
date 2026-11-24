import "server-only";
import { addDays } from "@/domain/dates";
import { fromDbDate } from "@/server/bookings/availability";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { EmailSender } from "@/server/email/sender";
import { reportProblem } from "@/server/observability";
import { PortOneError, type PortOneClient } from "./portone";

export interface RefundDeps {
  db: Db;
  pg: PortOneClient;
  now: Date;
}

/** `processing`: the PG accepted the cancellation but finishes it later (reconciled afterwards). */
export type RefundOutcome = "done" | "failed" | "skipped" | "processing";

const REASON_TEXT: Record<string, string> = {
  guest_cancel_full: "Guest cancellation (full refund)",
  guest_cancel_deposit_only: "Guest cancellation (deposit refund)",
  admin_cancel: "Cancelled by operator",
  late_payment_auto: "Payment after the hold expired",
  duplicate_payment_auto: "Duplicate payment",
};

/** Minor units of the payment our ledger says the PG has already refunded (done PG rows, excluding `exceptId`). */
async function ledgerRefunded(db: Db, paymentId: string, exceptId: string): Promise<number> {
  const agg = await db.refund.aggregate({
    where: { paymentId, manual: false, status: "done", id: { not: exceptId } },
    _sum: { amountRefundedMinor: true },
  });
  return agg._sum.amountRefundedMinor ?? 0;
}

/**
 * Executes one PG refund row: cancels `amountRefundedMinor` at PortOne for the row's payment and
 * marks the row done (payment → refunded / partially_refunded) or failed.
 *
 * No DB transaction is held across the PG call: the row is first claimed (`pending|failed →
 * processing`, conditional update, so concurrent callers cancel at most once), then the PG is
 * called, then the outcome is recorded. The balance sent as PortOne's `currentCancellableAmount`
 * guard comes from our own ledger (charged − done PG refunds), never from a fresh PG read: if a
 * previous attempt's cancel reached the PG but its response was lost, the PG's balance no longer
 * matches, PortOne refuses the duplicate, and the row is reconciled against the PG's cancelled total.
 *
 * `skipped` for manual (offline) rows, rows already done, and rows another executor holds.
 * `includeStuck` (operator retry) also re-runs a row left in `processing` by a crashed executor;
 * the ledger guard keeps that safe.
 */
export async function executeRefund(
  d: RefundDeps,
  refundId: string,
  opts: { includeStuck?: boolean } = {},
): Promise<RefundOutcome> {
  const claimable = opts.includeStuck ? (["pending", "failed", "processing"] as const) : (["pending", "failed"] as const);
  const claimed = await d.db.refund.updateMany({
    where: { id: refundId, manual: false, status: { in: [...claimable] } },
    data: { status: "processing" },
  });
  if (claimed.count === 0) return "skipped";
  const refund = await d.db.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  const charged = refund.payment.amountChargedMinor;
  const before = await ledgerRefunded(d.db, refund.paymentId, refundId);

  const record = async (status: "done" | "failed", pgRefundId?: string) => {
    await d.db.refund.update({ where: { id: refundId }, data: { status, ...(pgRefundId ? { pgRefundId } : {}) } });
    if (status === "done") {
      const fully = before + refund.amountRefundedMinor >= charged;
      await d.db.payment.update({ where: { id: refund.paymentId }, data: { status: fully ? "refunded" : "partially_refunded" } });
    }
    return status;
  };

  try {
    const res = await d.pg.cancelPayment(refund.paymentId, {
      amount: refund.amountRefundedMinor,
      reason: REASON_TEXT[refund.reason] ?? refund.reason,
      currentCancellableAmount: charged - before,
    });
    if (res.status === "FAILED") throw new PortOneError("cancelPayment", "CANCELLATION_FAILED");
    if (res.status === "REQUESTED") {
      // Accepted but not final: stays `processing` until reconcileProcessingRefunds sees it at the PG.
      await d.db.refund.update({ where: { id: refundId }, data: { pgRefundId: res.cancellationId } });
      return "processing";
    }
    return await record("done", res.cancellationId);
  } catch (e) {
    if (!(e instanceof PortOneError)) {
      // Unknown outcome (e.g. DB error after the PG call): leave it `processing` for an operator retry.
      reportProblem("refund interrupted (left processing)", { refundId, paymentId: refund.paymentId }, e);
      throw e;
    }
    if (e.kind === "CANCELLABLE_AMOUNT_CONSISTENCY_BROKEN" || e.kind === "PAYMENT_ALREADY_CANCELLED") {
      // Our ledger and the PG disagree: was this very refund already applied by a lost attempt?
      const pg = await d.pg.getPayment(refund.paymentId).catch(() => null);
      if (pg && pg.amount.cancelled - before >= refund.amountRefundedMinor) return await record("done");
    }
    reportProblem("refund failed at the PG", { refundId, paymentId: refund.paymentId, kind: e.kind }, e);
    return await record("failed");
  }
}

const RECONCILE_AFTER_MS = 10 * 60_000;

/**
 * Settles PG refunds left `processing` (asynchronous PG cancellations, or an executor that stopped
 * mid-way): when the PG's cancelled total covers the row on top of our done ledger, the row is
 * recorded done (+ payment status, guest `refund_completed`). Rows claimed in the last 10 minutes
 * are left to their executor. Optionally limited to one payment (webhook).
 */
export async function reconcileProcessingRefunds(
  d: RefundNoticeDeps,
  opts: { paymentId?: string } = {},
): Promise<{ done: number; stillPending: number }> {
  const rows = await d.db.refund.findMany({
    where: {
      manual: false,
      status: "processing",
      ...(opts.paymentId ? { paymentId: opts.paymentId } : { createdAt: { lte: new Date(d.now.getTime() - RECONCILE_AFTER_MS) } }),
    },
    include: { payment: true },
    take: 200,
  });
  let done = 0;
  for (const r of rows) {
    const pg = await d.pg.getPayment(r.paymentId).catch(() => null);
    const before = await ledgerRefunded(d.db, r.paymentId, r.id);
    if (!pg || pg.amount.cancelled - before < r.amountRefundedMinor) continue;
    const { count } = await d.db.refund.updateMany({ where: { id: r.id, status: "processing" }, data: { status: "done" } });
    if (count === 0) continue;
    const fully = before + r.amountRefundedMinor >= r.payment.amountChargedMinor;
    await d.db.payment.update({ where: { id: r.paymentId }, data: { status: fully ? "refunded" : "partially_refunded" } });
    await sendRefundNotice(d, r.id, "completed");
    done++;
  }
  return { done, stillPending: rows.length - done };
}

export interface RefundNoticeDeps extends RefundDeps {
  email: EmailSender;
  appUrl: string;
  adminEmails: string[];
}

type Locale = "en" | "ko";
const pick = (n: unknown, locale: Locale) => {
  const o = n as { en: string; ko?: string };
  return (locale === "ko" && o.ko ? o.ko : undefined) ?? o.en;
};

/**
 * Mail about one refund row: `refund_completed` to the guest (their locale) when it is done, or
 * `admin_refund_failed` to every operator when the PG refused it. Never throws.
 */
export async function sendRefundNotice(
  d: Omit<RefundNoticeDeps, "pg">,
  refundId: string,
  kind: "completed" | "failed",
): Promise<void> {
  try {
    const r = await d.db.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: { include: { booking: { include: { guest: true, room: { include: { house: true } } } } } } },
    });
    const b = r.payment.booking;
    const data = (locale: Locale) => ({
      guestName: b.guestName,
      houseName: pick(b.room.house.name, locale),
      roomName: pick(b.room.name, locale),
      moveIn: fromDbDate(b.moveIn),
      lastNight: addDays(fromDbDate(b.moveOut), -1),
      refundKrw: r.amountKrw,
    });
    if (kind === "completed") {
      const locale: Locale = b.guest.locale === "ko" ? "ko" : "en";
      await sendEmail(d.db, d.email, { to: b.guest.email, template: "refund_completed", locale, data: data(locale), bookingId: b.id });
    } else {
      for (const to of d.adminEmails) {
        await sendEmail(d.db, d.email, {
          to,
          template: "admin_refund_failed",
          locale: "ko",
          data: { ...data("ko"), bookingUrl: `${d.appUrl}/admin/bookings/${b.id}` },
          bookingId: b.id,
        });
      }
    }
  } catch (e) {
    console.error("[payments] refund notice failed", e);
  }
}

/**
 * Executes cancellation refunds at the PG (after the cancel committed) and mails the outcome:
 * guest `refund_completed` on success, operators `admin_refund_failed` on failure. Manual rows are
 * skipped (the operator pays them out and marks them done).
 */
export async function runRefunds(
  d: RefundNoticeDeps,
  refundIds: string[],
  opts: { includeStuck?: boolean } = {},
): Promise<RefundOutcome[]> {
  const out: RefundOutcome[] = [];
  for (const id of refundIds) {
    const res = await executeRefund(d, id, opts);
    if (res === "done") await sendRefundNotice(d, id, "completed");
    if (res === "failed") await sendRefundNotice(d, id, "failed");
    out.push(res);
  }
  return out;
}
