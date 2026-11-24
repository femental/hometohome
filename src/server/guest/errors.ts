import { BOOKING_ERROR_CODES, BookingError, type BookingErrorCode } from "@/server/bookings/errors";

// Not server-only: guest forms import the key mapping to show the localized message.

/** What guest actions return on failure; shown through `errors.*` messages, never as the raw code. */
export type GuestErrorKey = BookingErrorCode | "VALIDATION";

export const GUEST_ERROR_KEYS: readonly GuestErrorKey[] = [...BOOKING_ERROR_CODES, "VALIDATION"];

/** A guest-only refusal that is not a booking-domain rule. */
export class GuestError extends Error {
  constructor(public readonly code: GuestErrorKey) {
    super(code);
    this.name = "GuestError";
  }
}

/** Message key (from the root namespace) for a guest error, e.g. `errors.ROOM_UNAVAILABLE`. */
export function guestErrorMessageKey(code: GuestErrorKey): `errors.${GuestErrorKey}` {
  return `errors.${code}`;
}

/** The key for a known domain or guest error; null for anything else (callers rethrow it). */
export function toGuestErrorKey(e: unknown): GuestErrorKey | null {
  return e instanceof BookingError || e instanceof GuestError ? e.code : null;
}
