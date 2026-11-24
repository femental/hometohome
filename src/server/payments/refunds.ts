import "server-only";
import type { Db } from "@/server/db";
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
