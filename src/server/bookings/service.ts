import type { Booking, Payment, Prisma, RefundReason } from "@/generated/prisma/client";
import {
  effectiveStatus,
  HOLD_TTL_MS,
  nextStatus,
  REQUEST_TTL_MS,
} from "@/domain/booking-status";
import { addDays, isValidISODate, todayKST, type ISODate } from "@/domain/dates";
import { proportionalRefundMinor } from "@/domain/fx";
import { calculatePrice, PricingError, type PriceQuote } from "@/domain/pricing";
import { decideRefund, type RefundDecision } from "@/domain/refund";
import type { Db } from "@/server/db";
import { fromDbDate, isRoomFree, toDbDate } from "./availability";
import { BookingError, isExclusionViolation, type BookingErrorCode } from "./errors";

// Services never send email or call the PG: they report what happened and the caller
// (notifications in phase 2, PortOne in phase 4) acts on it.

export interface RequestInput {
  roomId: string;
  guestId: string;
  moveIn: ISODate;
  lastNight: ISODate;
  occupants: 1 | 2;
  guestName: string;
  nationality: string;
  gender: "male" | "female";
  contact: string;
  message: string;
  coOccupantName?: string;
  coOccupantGender?: "male" | "female";
}

export type CancelActor = { kind: "guest"; userId: string } | { kind: "admin" };

const MIN_LEAD_DAYS = 3;
const AUTO_REJECT_REASON = "auto: room confirmed for overlapping dates";

type Tx = Prisma.TransactionClient;

/** A failure decided before any write other than the expiry sync, so that write still commits. */
class Refusal {
  constructor(readonly error: BookingError) {}
}
const refuse = (code: BookingErrorCode, detail?: string) => new Refusal(new BookingError(code, detail));

function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // A top-level client opens a transaction; a caller's transaction client nests a savepoint in it.
  return db.$transaction(fn);
}

/**
 * Locks the booking row (`FOR UPDATE`), persists a read-time expiry if the stored status is
 * stale, then runs `fn` with the up-to-date row. `fn` returns a `Refusal` to fail while keeping
 * the expiry write and any writes `fn` made before refusing (e.g. approve's stale-hold release).
 */
async function withLockedBooking<T>(
  db: Db,
  bookingId: string,
  now: Date,
  fn: (tx: Tx, booking: Booking) => Promise<T | Refusal>,
): Promise<T> {
  const out = await inTransaction(db, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
    if (locked.length === 0) return refuse("INVALID_STATE", "booking not found");
    let booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const current = effectiveStatus(booking, now);
    if (current !== booking.status) {
      booking = await tx.booking.update({ where: { id: bookingId }, data: { status: current } });
    }
    return fn(tx, booking);
  });
  if (out instanceof Refusal) throw out.error;
  return out;
}

const invalidState = (b: Booking) => refuse("INVALID_STATE", `booking is ${b.status}`);

/** Writes that put a booking into an occupying status; maps a double-booking to ROOM_UNAVAILABLE. */
async function occupy(tx: Tx, bookingId: string, data: Prisma.BookingUpdateInput): Promise<Booking> {
  try {
    return await tx.booking.update({ where: { id: bookingId }, data });
  } catch (e) {
    if (isExclusionViolation(e)) throw new BookingError("ROOM_UNAVAILABLE", "booking_no_overlap");
    throw e;
  }
}

const overlaps = (b: Booking) => ({ moveIn: { lt: b.moveOut }, moveOut: { gt: b.moveIn } });

// ---------------------------------------------------------------------------
// Request

export async function createRequest(db: Db, input: RequestInput, now: Date): Promise<Booking> {
  const room = await db.room.findUnique({ where: { id: input.roomId }, include: { house: true } });
  if (!room) throw new BookingError("ROOM_NOT_FOUND");
  if (room.status !== "published" || room.house.status !== "published") {
    throw new BookingError("ROOM_NOT_PUBLISHED");
  }

  const { moveIn, lastNight } = input;
  if (!isValidISODate(moveIn) || !isValidISODate(lastNight) || lastNight < moveIn) {
    throw new BookingError("PRICING", "INVALID_RANGE");
  }
  const moveOut = addDays(lastNight, 1);

  if (moveIn < addDays(todayKST(now), MIN_LEAD_DAYS)) throw new BookingError("TOO_SOON");
  if (moveIn < fromDbDate(room.availableFrom)) throw new BookingError("BEFORE_AVAILABLE");
  if (input.occupants > room.maxOccupants) throw new BookingError("TOO_MANY_OCCUPANTS");

  const genders = input.occupants === 2 ? [input.gender, input.coOccupantGender] : [input.gender];
  if (room.genderPolicy !== "any" && genders.some((g) => g !== room.genderPolicy)) {
    throw new BookingError("GENDER_MISMATCH");
  }

  let quote: PriceQuote;
  try {
    quote = calculatePrice({
      monthlyRent: room.monthlyRent,
      extraPersonMonthlyFee: room.extraPersonMonthlyFee,
      deposit: room.deposit,
      moveIn,
      moveOut,
      occupants: input.occupants,
    });
  } catch (e) {
    if (e instanceof PricingError) throw new BookingError("PRICING", e.code);
    throw e;
  }

  if (!(await isRoomFree(db, room.id, moveIn, moveOut, now))) throw new BookingError("ROOM_UNAVAILABLE");

  return db.booking.create({
    data: {
      roomId: room.id,
      guestId: input.guestId,
      moveIn: toDbDate(moveIn),
      moveOut: toDbDate(moveOut),
      guestName: input.guestName,
      nationality: input.nationality,
      gender: input.gender,
      contact: input.contact,
      message: input.message,
      occupants: input.occupants,
      coOccupantName: input.occupants === 2 ? (input.coOccupantName ?? null) : null,
      coOccupantGender: input.occupants === 2 ? (input.coOccupantGender ?? null) : null,
      monthlyRent: quote.appliedMonthlyRent,
      deposit: quote.deposit,
      fullMonths: quote.fullMonths,
      extraDays: quote.extraDays,
      proratedAmount: quote.proratedAmount,
      stayTotal: quote.stayTotal,
      firstRentAmount: quote.firstRentAmount,
      firstPaymentTotal: quote.firstPaymentTotal,
      status: "requested",
      requestedAt: now,
      requestExpiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
    },
  });
}

/** Approves with the request-time price snapshot and starts the 24h payment hold. */
export function approveRequest(db: Db, bookingId: string, now: Date): Promise<Booking> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (b.status !== "requested") return invalidState(b);

    // Holds past their expiry still sit in the exclusion constraint until the cron runs;
    // release the overlapping ones so they cannot block this approval.
    await tx.booking.updateMany({
      where: { roomId: b.roomId, status: "awaiting_payment", holdExpiresAt: { lte: now }, ...overlaps(b) },
      data: { status: "payment_expired" },
    });
    if (!(await isRoomFree(tx, b.roomId, fromDbDate(b.moveIn), fromDbDate(b.moveOut), now, b.id))) {
      return refuse("ROOM_UNAVAILABLE");
    }

    return occupy(tx, b.id, {
      status: nextStatus(b.status, "approve"),
      approvedAt: now,
      holdExpiresAt: new Date(now.getTime() + HOLD_TTL_MS),
    });
  });
}

export function rejectRequest(db: Db, bookingId: string, reason: string, now: Date): Promise<Booking> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (b.status !== "requested") return invalidState(b);
    return tx.booking.update({
      where: { id: b.id },
      data: { status: nextStatus(b.status, "reject"), rejectedReason: reason },
    });
  });
}

export function withdrawRequest(db: Db, bookingId: string, guestId: string, now: Date): Promise<Booking> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (b.guestId !== guestId) return refuse("FORBIDDEN");
    if (b.status !== "requested") return invalidState(b);
    return tx.booking.update({ where: { id: b.id }, data: { status: nextStatus(b.status, "withdraw") } });
  });
}

/** Cron: persists expiries that read-time logic already applies. */
export async function expireDue(
  db: Db,
  now: Date,
): Promise<{ requestExpired: string[]; paymentExpired: string[] }> {
  const requestExpired = await db.booking.updateManyAndReturn({
    where: { status: "requested", requestExpiresAt: { lte: now } },
    data: { status: nextStatus("requested", "expire_request") },
    select: { id: true },
  });
  const paymentExpired = await db.booking.updateManyAndReturn({
    where: { status: "awaiting_payment", holdExpiresAt: { lte: now } },
    data: { status: nextStatus("awaiting_payment", "expire_payment") },
    select: { id: true },
  });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
  return { requestExpired: ids(requestExpired), paymentExpired: ids(paymentExpired) };
}

// ---------------------------------------------------------------------------
// Payment

/** awaiting_payment -> confirmed by `paymentId`, then auto-rejects live overlapping requests on the room. */
async function confirmLocked(tx: Tx, b: Booking, paymentId: string, now: Date): Promise<string[]> {
  await occupy(tx, b.id, {
    status: nextStatus(b.status, "pay"),
    confirmedAt: now,
    confirmedPayment: { connect: { id: paymentId } },
  });
  const rejected = await tx.booking.updateManyAndReturn({
    where: {
      roomId: b.roomId,
      id: { not: b.id },
      status: "requested",
      OR: [{ requestExpiresAt: null }, { requestExpiresAt: { gt: now } }],
      ...overlaps(b),
    },
    data: { status: nextStatus("requested", "reject"), rejectedReason: AUTO_REJECT_REASON },
    select: { id: true },
  });
  return rejected.map((r) => r.id).sort();
}

/** The auto refund a payment already got, whichever reason it was given under. */
function findAutoRefund(tx: Tx, paymentId: string) {
  return tx.refund.findFirst({
    where: { paymentId, reason: { in: ["late_payment_auto", "duplicate_payment_auto"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, reason: true },
  });
}

/** The single full refund for a payment that cannot be kept; callers check `findAutoRefund` first. */
async function createAutoRefund(
  tx: Tx,
  payment: Payment,
  reason: "late_payment_auto" | "duplicate_payment_auto",
): Promise<string> {
  const created = await tx.refund.create({
    data: {
      paymentId: payment.id,
      reason,
      amountKrw: payment.amountKrw,
      amountRefundedMinor: payment.amountChargedMinor,
      status: "pending",
      manual: payment.method === "offline",
    },
  });
  return created.id;
}

export type ConfirmPaidResult =
  | { result: "confirmed"; autoRejectedIds: string[] }
  | { result: "already_confirmed" }
  | { result: "late_payment"; refundId: string }
  | { result: "duplicate_payment"; refundId: string };

/**
 * Confirms a booking for a payment the server already verified with the PG. Idempotent: the
 * webhook and the client redirect may both call it, in any order or at once.
 * - same payment again → `already_confirmed` (no writes)
 * - another payment on a confirmed booking → `duplicate_payment`
 * - payment after the hold expired, or on a cancelled hold → `late_payment`
 * Late and duplicate payments get one pending full refund row for the caller to execute. A
 * payment never gets a second one: repeat calls return the existing row under its original
 * result, even after the booking or the payment status has moved on (e.g. refunded).
 */
export function confirmPaid(db: Db, bookingId: string, paymentId: string, now: Date): Promise<ConfirmPaidResult> {
  return withLockedBooking<ConfirmPaidResult>(db, bookingId, now, async (tx, b) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.bookingId !== b.id) return refuse("INVALID_STATE", "payment does not belong to booking");

    // Repeat calls are answered before the payment's own checks: by the time a webhook is
    // re-delivered, phase 4 may have marked the payment refunded or partially_refunded.
    // The payment that confirmed this booking is never late or duplicate, whatever happened since
    // (completed, or cancelled with its own cancellation refund).
    if (b.confirmedPaymentId === payment.id) return { result: "already_confirmed" };
    const existing = await findAutoRefund(tx, payment.id);
    if (existing) {
      return existing.reason === "duplicate_payment_auto"
        ? { result: "duplicate_payment", refundId: existing.id }
        : { result: "late_payment", refundId: existing.id };
    }

    if (payment.status !== "paid") return refuse("INVALID_STATE", `payment is ${payment.status}`);
    if (payment.amountKrw !== b.firstPaymentTotal) {
      return refuse("INVALID_STATE", `payment amount ${payment.amountKrw} != ${b.firstPaymentTotal}`);
    }

    switch (b.status) {
      case "awaiting_payment": // live: withLockedBooking already persisted an expired hold
        return { result: "confirmed", autoRejectedIds: await confirmLocked(tx, b, payment.id, now) };
      case "confirmed":
      case "completed":
        return { result: "duplicate_payment", refundId: await createAutoRefund(tx, payment, "duplicate_payment_auto") };
      case "payment_expired":
      case "cancelled":
        return { result: "late_payment", refundId: await createAutoRefund(tx, payment, "late_payment_auto") };
      default:
        return invalidState(b);
    }
  });
}

/** Operator records money received outside the PG (spec §11) and confirms the booking. */
export function confirmOfflinePayment(
  db: Db,
  bookingId: string,
  p: { method: "bank_transfer" | "cash" | "other"; amountKrw: number; note: string },
  now: Date,
): Promise<{ result: "confirmed"; autoRejectedIds: string[] }> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (b.status !== "awaiting_payment") return invalidState(b);
    if (p.amountKrw !== b.firstPaymentTotal) {
      return refuse("INVALID_STATE", `payment amount ${p.amountKrw} != ${b.firstPaymentTotal}`);
    }
    const payment = await tx.payment.create({
      data: {
        bookingId: b.id,
        method: "offline",
        currency: "KRW",
        amountKrw: p.amountKrw,
        amountChargedMinor: p.amountKrw,
        status: "paid",
        offlineNote: `${p.method}: ${p.note}`,
        paidAt: now,
      },
    });
    return { result: "confirmed" as const, autoRejectedIds: await confirmLocked(tx, b, payment.id, now) };
  });
}

// ---------------------------------------------------------------------------
// Cancel and after move-in

function refundReason(actor: CancelActor, decision: RefundDecision): RefundReason {
  if (actor.kind === "admin") return "admin_cancel";
  return decision.kind === "full" ? "guest_cancel_full" : "guest_cancel_deposit_only";
}

/**
 * Cancels a confirmed booking (guest: own booking only) and records a pending refund row on the
 * confirming payment for the caller to execute; an offline payment gets a `manual` row. Any
 * other payment on the booking is a duplicate that already carries its own full auto refund.
 * An operator may also cancel an unpaid hold, which creates no refund.
 */
export function cancelBooking(
  db: Db,
  bookingId: string,
  actor: CancelActor,
  now: Date,
): Promise<{ booking: Booking; refund: RefundDecision; refundIds: string[] }> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (actor.kind === "guest" && b.guestId !== actor.userId) return refuse("FORBIDDEN");

    let refund: RefundDecision;
    const refundIds: string[] = [];
    if (b.status === "confirmed") {
      refund = decideRefund({
        firstPaymentTotal: b.firstPaymentTotal,
        deposit: b.deposit,
        moveIn: fromDbDate(b.moveIn),
        now,
        actor: actor.kind,
      });
      if (refund.kind === "not_allowed") return refuse("CANCEL_NOT_ALLOWED");

      if (!b.confirmedPaymentId) return refuse("INVALID_STATE", "confirmed booking has no confirming payment");
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: b.confirmedPaymentId } });
      const row = await tx.refund.create({
        data: {
          paymentId: payment.id,
          reason: refundReason(actor, refund),
          amountKrw: refund.amountKrw,
          amountRefundedMinor:
            payment.currency === "KRW"
              ? refund.amountKrw
              : proportionalRefundMinor(payment.amountChargedMinor, payment.amountKrw, refund.amountKrw),
          status: "pending",
          manual: payment.method === "offline",
        },
      });
      refundIds.push(row.id);
    } else if (b.status === "awaiting_payment" && actor.kind === "admin") {
      refund = { kind: "not_allowed", amountKrw: 0 };
    } else {
      return invalidState(b);
    }

    const booking = await tx.booking.update({
      where: { id: b.id },
      data: { status: nextStatus(b.status, "cancel"), cancelledAt: now, cancelReason: `${actor.kind}_cancel` },
    });
    return { booking, refund, refundIds };
  });
}

/** Operator marks a confirmed stay as completed, from the move-in day (KST) on. */
export function markCompleted(db: Db, bookingId: string, now: Date): Promise<Booking> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (b.status !== "confirmed") return invalidState(b);
    if (todayKST(now) < fromDbDate(b.moveIn)) return refuse("INVALID_STATE", "before move-in day");
    return tx.booking.update({ where: { id: b.id }, data: { status: nextStatus(b.status, "complete") } });
  });
}

/** Operator records that the deposit was returned (offline) for a completed stay. */
export function markDepositReturned(db: Db, bookingId: string, note: string, now: Date): Promise<Booking> {
  return withLockedBooking(db, bookingId, now, async (tx, b) => {
    if (b.status !== "completed") return invalidState(b);
    if (b.depositReturnedAt) return refuse("INVALID_STATE", "deposit already returned");
    return tx.booking.update({
      where: { id: b.id },
      data: { depositReturnedAt: now, depositReturnNote: note },
    });
  });
}
