export type BookingStatus =
  | "requested"
  | "rejected"
  | "request_expired"
  | "withdrawn"
  | "awaiting_payment"
  | "payment_expired"
  | "confirmed"
  | "cancelled"
  | "completed";

export type BookingEvent =
  | "approve"
  | "reject"
  | "expire_request"
  | "withdraw"
  | "pay"
  | "expire_payment"
  | "cancel"
  | "complete";

export const REQUEST_TTL_MS = 48 * 3600_000;
export const HOLD_TTL_MS = 24 * 3600_000;

/** Statuses that occupy the room's calendar. */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = ["awaiting_payment", "confirmed"];

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: BookingStatus,
    public readonly event: BookingEvent,
  ) {
    super(`Invalid booking transition: ${from} --${event}-->`);
    this.name = "InvalidTransitionError";
  }
}

// Allowed transitions; anything not listed is invalid.
// awaiting_payment --cancel--> is an operator cancel (unpaid, so no refund).
const TRANSITIONS: Partial<Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>>> = {
  requested: {
    approve: "awaiting_payment",
    reject: "rejected",
    expire_request: "request_expired",
    withdraw: "withdrawn",
  },
  awaiting_payment: {
    pay: "confirmed",
    expire_payment: "payment_expired",
    cancel: "cancelled",
  },
  confirmed: {
    cancel: "cancelled",
    complete: "completed",
  },
};

export function nextStatus(from: BookingStatus, event: BookingEvent): BookingStatus {
  const to = TRANSITIONS[from]?.[event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

/** Applies read-time expiry: a stale request or payment hold is reported as expired. */
export function effectiveStatus(
  b: { status: BookingStatus; requestExpiresAt: Date | null; holdExpiresAt: Date | null },
  now: Date,
): BookingStatus {
  if (b.status === "requested" && b.requestExpiresAt && now >= b.requestExpiresAt) {
    return "request_expired";
  }
  if (b.status === "awaiting_payment" && b.holdExpiresAt && now >= b.holdExpiresAt) {
    return "payment_expired";
  }
  return b.status;
}
