import { effectiveStatus } from "@/domain/booking-status";
import { proportionalRefundMinor } from "@/domain/fx";
import { decideRefund, type RefundDecision } from "@/domain/refund";
import type { Db } from "@/server/db";
import { fromDbDate } from "./availability";
import { BookingError } from "./errors";
import type { CancelActor } from "./service";

export type CancellationPreview = RefundDecision & {
  payments: { method: string; currency: string; refundMinor: number }[];
};

/** What `cancelBooking` would record for the same actor and time, without writing anything. */
export async function previewCancellation(
  db: Db,
  bookingId: string,
  actor: CancelActor,
  now: Date,
): Promise<CancellationPreview> {
  const b = await db.booking.findUnique({ where: { id: bookingId } });
  if (!b) throw new BookingError("NOT_FOUND", "booking not found");
  if (actor.kind === "guest" && b.guestId !== actor.userId) throw new BookingError("FORBIDDEN");

  const status = effectiveStatus(b, now);
  if (status === "awaiting_payment" && actor.kind === "admin") {
    return { kind: "not_allowed", amountKrw: 0, payments: [] };
  }
  if (status !== "confirmed") throw new BookingError("INVALID_STATE", `booking is ${status}`);

  const decision = decideRefund({
    firstPaymentTotal: b.firstPaymentTotal,
    deposit: b.deposit,
    moveIn: fromDbDate(b.moveIn),
    now,
    actor: actor.kind,
  });
  if (decision.kind === "not_allowed") throw new BookingError("CANCEL_NOT_ALLOWED");
  if (!b.confirmedPaymentId) throw new BookingError("INVALID_STATE", "confirmed booking has no confirming payment");

  const payment = await db.payment.findUniqueOrThrow({ where: { id: b.confirmedPaymentId } });
  return {
    ...decision,
    payments: [
      {
        method: payment.method,
        currency: payment.currency,
        refundMinor:
          payment.currency === "KRW"
            ? decision.amountKrw
            : proportionalRefundMinor(payment.amountChargedMinor, payment.amountKrw, decision.amountKrw),
      },
    ],
  };
}
