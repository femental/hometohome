import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { effectiveStatus, type BookingStatus } from "@/domain/booking-status";
import { addDays, type ISODate } from "@/domain/dates";
import { cancellationDeadline } from "@/domain/refund";
import type { Locale } from "@/i18n/routing";
import { pickText } from "@/lib/i18n-text";
import { previewCancellation, type CancellationPreview } from "@/server/admin/bookings";
import { fromDbDate } from "@/server/bookings/availability";
import { BookingError } from "@/server/bookings/errors";
import { cancelBooking, withdrawRequest } from "@/server/bookings/service";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { TemplateData } from "@/server/email/templates";
import type { LocalizedText } from "@/server/rooms/search";
import { GuestError, toGuestErrorKey, type GuestErrorKey } from "./errors";
import type { RequestDeps } from "./requests";

// A guest only ever sees and changes their own bookings. Someone else's booking and a booking that
// does not exist look the same: reads return null, commands fail with FORBIDDEN, which guests see as
// NOT_FOUND (guestBookingErrorKey).

export type GuestBookingDeps = RequestDeps;

const bookingId = z.uuid();

/** True for a well-formed booking id (anything else cannot be a booking). */
export function isBookingId(id: string): boolean {
  return bookingId.safeParse(id).success;
}

/** The GuestErrorKey for a guest booking command's failure; null for an unexpected error (rethrow). */
export function guestBookingErrorKey(e: unknown): GuestErrorKey | null {
  const key = toGuestErrorKey(e);
  return key === "FORBIDDEN" ? "NOT_FOUND" : key;
}

/** Results of the "My bookings" actions. */
export type WithdrawResult = { ok: true } | { ok: false; error: GuestErrorKey };
export type CancelResult = { ok: true; refundKrw: number } | { ok: false; error: GuestErrorKey };

const lastNightOf = (b: { moveOut: Date }): ISODate => addDays(fromDbDate(b.moveOut), -1);
const toLocale = (v: string): Locale => (v === "ko" ? "ko" : "en");

const withPlace = {
  room: { select: { id: true, name: true, house: { select: { id: true, name: true } } } },
} satisfies Prisma.BookingInclude;

// ---------------------------------------------------------------------------
// Reads

export type GuestBookingRow = {
  id: string;
  status: BookingStatus;
  houseName: LocalizedText;
  roomName: LocalizedText;
  moveIn: ISODate;
  lastNight: ISODate;
  occupants: number;
  firstPaymentTotal: number;
  requestExpiresAt: Date | null;
  holdExpiresAt: Date | null;
};

/** The guest's bookings, newest request first, with the read-time (effective) status. */
export async function listMyBookings(db: Db, userId: string, now: Date): Promise<GuestBookingRow[]> {
  const rows = await db.booking.findMany({
    where: { guestId: userId },
    include: withPlace,
    orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    status: effectiveStatus(b, now),
    houseName: b.room.house.name as LocalizedText,
    roomName: b.room.name as LocalizedText,
    moveIn: fromDbDate(b.moveIn),
    lastNight: lastNightOf(b),
    occupants: b.occupants,
    firstPaymentTotal: b.firstPaymentTotal,
    requestExpiresAt: b.requestExpiresAt,
    holdExpiresAt: b.holdExpiresAt,
  }));
}

export type GuestBookingDetail = {
  id: string;
  status: BookingStatus;
  house: { id: string; name: LocalizedText };
  room: { id: string; name: LocalizedText };
  moveIn: ISODate;
  lastNight: ISODate;
  occupants: number;
  guestName: string;
  coOccupantName: string | null;
  /** Price snapshot taken at request time (never recalculated). */
  price: {
    monthlyRent: number;
    deposit: number;
    fullMonths: number;
    extraDays: number;
    proratedAmount: number;
    stayTotal: number;
    firstRentAmount: number;
    firstPaymentTotal: number;
  };
  requestedAt: Date;
  requestExpiresAt: Date | null;
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  /** Last instant of a full-refund guest cancellation. */
  cancellationDeadline: Date;
  /** Refunds recorded on this booking's payments, oldest first. */
  refunds: { amountKrw: number; status: string }[];
};

/** One of the guest's own bookings; null when it is someone else's or does not exist. */
export async function getMyBooking(
  db: Db,
  userId: string,
  id: string,
  now: Date,
): Promise<GuestBookingDetail | null> {
  if (!isBookingId(id)) return null;
  const b = await db.booking.findFirst({
    where: { id, guestId: userId },
    include: {
      ...withPlace,
      payments: {
        select: { refunds: { select: { amountKrw: true, status: true, createdAt: true } } },
      },
    },
  });
  if (!b) return null;
  const moveIn = fromDbDate(b.moveIn);
  return {
    id: b.id,
    status: effectiveStatus(b, now),
    house: { id: b.room.house.id, name: b.room.house.name as LocalizedText },
    room: { id: b.room.id, name: b.room.name as LocalizedText },
    moveIn,
    lastNight: lastNightOf(b),
    occupants: b.occupants,
    guestName: b.guestName,
    coOccupantName: b.coOccupantName,
    price: {
      monthlyRent: b.monthlyRent,
      deposit: b.deposit,
      fullMonths: b.fullMonths,
      extraDays: b.extraDays,
      proratedAmount: b.proratedAmount,
      stayTotal: b.stayTotal,
      firstRentAmount: b.firstRentAmount,
      firstPaymentTotal: b.firstPaymentTotal,
    },
    requestedAt: b.requestedAt,
    requestExpiresAt: b.requestExpiresAt,
    holdExpiresAt: b.holdExpiresAt,
    confirmedAt: b.confirmedAt,
    cancelledAt: b.cancelledAt,
    cancellationDeadline: cancellationDeadline(moveIn),
    refunds: b.payments
      .flatMap((p) => p.refunds)
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .map((r) => ({ amountKrw: r.amountKrw, status: r.status })),
  };
}

/**
 * What cancelling now would refund (same rules as `guestCancel`, nothing written). `not_allowed`
 * from the move-in day on. Null when there is nothing the guest could cancel: someone else's
 * booking, or not confirmed (requests are withdrawn instead; guests cannot cancel unpaid holds).
 */
export async function guestPreviewCancel(
  db: Db,
  userId: string,
  id: string,
  now: Date,
): Promise<CancellationPreview | null> {
  if (!isBookingId(id)) return null;
  try {
    return await previewCancellation(db, id, { kind: "guest", userId }, now);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
    if (e.code === "CANCEL_NOT_ALLOWED") return { kind: "not_allowed", amountKrw: 0, payments: [] };
    return null; // FORBIDDEN, or INVALID_STATE (missing / not confirmed)
  }
}

// ---------------------------------------------------------------------------
// Commands

/** Refuses (FORBIDDEN) before any write unless the booking exists and is the guest's. */
async function assertOwn(db: Db, userId: string, id: string): Promise<void> {
  if (!isBookingId(id)) throw new BookingError("FORBIDDEN");
  const own = await db.booking.count({ where: { id, guestId: userId } });
  if (own === 0) throw new BookingError("FORBIDDEN");
}

/** Withdraws the guest's own pending request (BookingError INVALID_STATE in any other status). */
export async function guestWithdraw(deps: Pick<GuestBookingDeps, "db" | "now">, userId: string, id: string): Promise<void> {
  await assertOwn(deps.db, userId, id);
  await withdrawRequest(deps.db, id, userId, deps.now);
}

/** A refund the guest can confirm: what the preview showed them. */
export type ExpectedRefundKind = "full" | "deposit_only";

/**
 * Cancels the guest's own confirmed booking with the refund the rules give now (pending refund row
 * on the confirming payment), then emails the guest (`booking_cancelled`, their locale) and every
 * operator (`admin_booking_cancelled`, Korean). Email problems are logged and never change the result.
 *
 * `expectedKind` is the refund the guest saw and confirmed. If the rules give a different one at
 * `deps.now` (e.g. the full-refund deadline passed since the preview), it refuses with GuestError
 * REFUND_CHANGED before any write. The decision depends only on `deps.now` and fields a cancellation
 * cannot race with (move-in, amounts), so `cancelBooking` with the same `now` decides the same.
 */
export async function guestCancel(
  deps: GuestBookingDeps,
  userId: string,
  id: string,
  expectedKind: ExpectedRefundKind,
): Promise<{ refundKrw: number }> {
  await assertOwn(deps.db, userId, id);
  const actor = { kind: "guest", userId } as const;

  let current: CancellationPreview["kind"] | null = null;
  try {
    current = (await previewCancellation(deps.db, id, actor, deps.now)).kind;
  } catch (e) {
    // Not cancellable at all (not confirmed, move-in day…): cancelBooking reports it with its own code.
    if (!(e instanceof BookingError)) throw e;
  }
  if (current !== null && current !== expectedKind) throw new GuestError("REFUND_CHANGED");

  const { refund } = await cancelBooking(deps.db, id, actor, deps.now);

  try {
    const b = await deps.db.booking.findUniqueOrThrow({
      where: { id },
      include: { guest: { select: { email: true, locale: true } }, ...withPlace },
    });
    const data = (locale: Locale): TemplateData => ({
      guestName: b.guestName,
      houseName: pickText(b.room.house.name as LocalizedText, locale),
      roomName: pickText(b.room.name as LocalizedText, locale),
      moveIn: fromDbDate(b.moveIn),
      lastNight: lastNightOf(b),
    });
    const guestLocale = toLocale(b.guest.locale);

    await sendEmail(deps.db, deps.email, {
      to: b.guest.email,
      template: "booking_cancelled",
      locale: guestLocale,
      data: {
        ...data(guestLocale),
        refundKrw: refund.amountKrw,
        bookingUrl: `${deps.appUrl}/${guestLocale}/bookings/${b.id}`,
      },
      bookingId: b.id,
    });
    for (const to of deps.adminEmails) {
      await sendEmail(deps.db, deps.email, {
        to,
        template: "admin_booking_cancelled",
        locale: "ko",
        data: {
          ...data("ko"),
          reason: "게스트가 직접 취소",
          bookingUrl: `${deps.appUrl}/admin/bookings/${b.id}`,
          ...(refund.amountKrw > 0 ? { refundKrw: refund.amountKrw } : {}),
        },
        bookingId: b.id,
      });
    }
  } catch (e) {
    console.error("[guest] cancellation notification failed", e);
  }

  return { refundKrw: refund.amountKrw };
}
