import "server-only";
import { addDays } from "@/domain/dates";
import { fromDbDate } from "@/server/bookings/availability";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { EmailSender } from "@/server/email/sender";
import { PortOneError, type PortOneClient } from "./portone";

export interface RefundDeps {
  db: Db;
  pg: PortOneClient;
  now: Date;
}

export type RefundOutcome = "done" | "failed" | "skipped";

const REASON_TEXT: Record<string, string> = {
  guest_cancel_full: "Guest cancellation (full refund)",
  guest_cancel_deposit_only: "Guest cancellation (deposit refund)",
  admin_cancel: "Cancelled by operator",
  late_payment_auto: "Payment after the hold expired",
  duplicate_payment_auto: "Duplicate payment",
};

/**
 * Executes one PG refund row: cancels `amountRefundedMinor` at PortOne for the row's payment and
 * marks the row done (payment → refunded / partially_refunded) or failed. Runs under a `FOR UPDATE`
 * lock on the refund row, so concurrent calls cancel at most once; `skipped` for manual (offline)
 * rows and rows already done. A failed row can be executed again (operator retry).
 */
export async function executeRefund(d: RefundDeps, refundId: string): Promise<RefundOutcome> {
  return d.db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM refunds WHERE id = ${refundId} FOR UPDATE`;
      if (locked.length === 0) return "skipped";
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
      if (refund.manual || refund.status === "done") return "skipped";

      try {
        const pg = await d.pg.getPayment(refund.paymentId);
        if (!pg) throw new PortOneError("getPayment", "PAYMENT_NOT_FOUND");
        const cancellable = pg.amount.total - pg.amount.cancelled;
        const res = await d.pg.cancelPayment(refund.paymentId, {
          amount: refund.amountRefundedMinor,
          reason: REASON_TEXT[refund.reason] ?? refund.reason,
          currentCancellableAmount: cancellable,
        });
        if (res.status === "FAILED") throw new PortOneError("cancelPayment", "CANCELLATION_FAILED");

        await tx.refund.update({ where: { id: refundId }, data: { status: "done", pgRefundId: res.cancellationId } });
        const fully = refund.amountRefundedMinor >= cancellable;
        await tx.payment.update({
          where: { id: refund.paymentId },
          data: { status: fully ? "refunded" : "partially_refunded" },
        });
        return "done";
      } catch (e) {
        if (!(e instanceof PortOneError)) throw e;
        console.error(`[payments] refund ${refundId} failed: ${e.message}`);
        await tx.refund.update({ where: { id: refundId }, data: { status: "failed" } });
        return "failed";
      }
    },
    { timeout: 30_000 },
  );
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
export async function runRefunds(d: RefundNoticeDeps, refundIds: string[]): Promise<RefundOutcome[]> {
  const out: RefundOutcome[] = [];
  for (const id of refundIds) {
    const res = await executeRefund(d, id);
    if (res === "done") await sendRefundNotice(d, id, "completed");
    if (res === "failed") await sendRefundNotice(d, id, "failed");
    out.push(res);
  }
  return out;
}
