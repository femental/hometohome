export const BOOKING_ERROR_CODES = [
  "ROOM_NOT_FOUND",
  "ROOM_NOT_PUBLISHED",
  "TOO_SOON",
  "BEFORE_AVAILABLE",
  "GENDER_MISMATCH",
  "TOO_MANY_OCCUPANTS",
  "ROOM_UNAVAILABLE",
  "PRICING",
  "INVALID_STATE",
  "FORBIDDEN",
  "CANCEL_NOT_ALLOWED",
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "BookingError";
  }
}

const EXCLUSION_VIOLATION = "23P01";

/**
 * True when `e` is a Postgres exclusion-constraint violation (SQLSTATE 23P01).
 *
 * Through Prisma 7 + @prisma/adapter-pg it arrives as a PrismaClientKnownRequestError
 * (code P2039 for model queries, P2010 for raw queries) carrying
 * `meta.driverAdapterError.cause.originalCode === "23P01"`. A bare DriverAdapterError
 * (`cause.originalCode`) or a raw pg error (`code`) is also recognised.
 */
export function isExclusionViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as {
    code?: unknown;
    cause?: { originalCode?: unknown; code?: unknown };
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } };
  };
  const candidates = [
    err.code,
    err.cause?.originalCode,
    err.cause?.code,
    err.meta?.driverAdapterError?.cause?.originalCode,
    err.meta?.driverAdapterError?.cause?.code,
  ];
  return candidates.includes(EXCLUSION_VIOLATION);
}
