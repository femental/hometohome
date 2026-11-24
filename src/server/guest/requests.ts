import "server-only";
import { z } from "zod";
import { addDays, isValidISODate, todayKST } from "@/domain/dates";
import { calculatePrice, PricingError, type PriceQuote } from "@/domain/pricing";
import type { Locale } from "@/i18n/routing";
import { pickText } from "@/lib/i18n-text";
import { isRoomFree } from "@/server/bookings/availability";
import { createRequest, type RequestInput } from "@/server/bookings/service";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { EmailSender } from "@/server/email/sender";
import type { TemplateData } from "@/server/email/templates";
import type { LocalizedText } from "@/server/rooms/search";
import { getPublicRoom } from "./catalog";
import type { GuestErrorKey } from "./errors";

// ---------------------------------------------------------------------------
// Input schemas (FormData strings or plain values)

const MIN_LEAD_DAYS = 3; // same rule as createRequest

const isoDate = z.string().refine(isValidISODate, "Invalid date");
const gender = z.enum(["male", "female"]);
const occupants = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.union([z.literal(1), z.literal(2)]),
);

export const quoteInput = z.object({
  roomId: z.uuid(),
  moveIn: isoDate,
  lastNight: isoDate,
  occupants,
});

export type QuoteInput = z.output<typeof quoteInput>;

const coOccupant = z.object({
  coOccupantName: z.string().trim().min(1).max(100),
  coOccupantGender: gender,
});

/**
 * The guest's request form. Co-occupant fields are required for two occupants and dropped for one,
 * so a stale value left in a hidden field never reaches the booking.
 */
export const requestInput = quoteInput
  .extend({
    guestName: z.string().trim().min(1).max(100),
    nationality: z.string().trim().min(2).max(56),
    gender,
    contact: z.string().trim().min(3).max(100),
    message: z.string().trim().max(1000).default(""),
    coOccupantName: z.unknown().optional(),
    coOccupantGender: z.unknown().optional(),
  })
  .transform((v, ctx) => {
    const { coOccupantName, coOccupantGender, ...rest } = v;
    if (rest.occupants === 1) return rest;
    const co = coOccupant.safeParse({ coOccupantName, coOccupantGender });
    if (!co.success) {
      for (const issue of co.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return { ...rest, ...co.data };
  });

/** A validated request, before the server adds the guest id. */
export type RequestFields = Omit<RequestInput, "guestId">;

// ---------------------------------------------------------------------------
// Results the room page's actions return

export type QuoteResult = { ok: true; quote: PriceQuote } | { ok: false; error: GuestErrorKey };

/** Failure of a booking request (success redirects). `fields` names invalid inputs on VALIDATION. */
export type SubmitRequestResult = { ok: false; error: GuestErrorKey; fields?: string[] };

// ---------------------------------------------------------------------------
// Price preview

/**
 * Server-side price preview for a published room: the same pricing function and the same refusals a
 * request would meet (except gender, which depends on the form). Unpublished or unknown → NOT_FOUND.
 */
export async function quoteRoom(db: Db, input: QuoteInput, now: Date): Promise<QuoteResult> {
  const room = await getPublicRoom(db, input.roomId);
  if (!room) return { ok: false, error: "NOT_FOUND" };

  const { moveIn, lastNight } = input;
  if (lastNight < moveIn) return { ok: false, error: "PRICING" };
  if (moveIn < addDays(todayKST(now), MIN_LEAD_DAYS)) return { ok: false, error: "TOO_SOON" };
  if (moveIn < room.availableFrom) return { ok: false, error: "BEFORE_AVAILABLE" };
  if (input.occupants > room.maxOccupants) return { ok: false, error: "TOO_MANY_OCCUPANTS" };

  const moveOut = addDays(lastNight, 1);
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
    if (e instanceof PricingError) return { ok: false, error: "PRICING" };
    throw e;
  }

  if (!(await isRoomFree(db, room.id, moveIn, moveOut, now))) return { ok: false, error: "ROOM_UNAVAILABLE" };
  return { ok: true, quote };
}

// ---------------------------------------------------------------------------
// Booking request

export interface RequestDeps {
  db: Db;
  email: EmailSender;
  now: Date;
  appUrl: string;
  adminEmails: string[];
}

export interface RequestUser {
  id: string;
  email: string;
  locale: Locale;
}

/**
 * Creates the request (BookingError on refusal, no email then), then emails the guest
 * (`request_received`, in their locale) and every operator (`admin_new_request`, Korean).
 * Email problems are logged and never change the result.
 */
export async function submitRequest(
  deps: RequestDeps,
  user: RequestUser,
  input: RequestFields,
): Promise<{ bookingId: string }> {
  const booking = await createRequest(deps.db, { ...input, guestId: user.id }, deps.now);

  try {
    const room = await deps.db.room.findUniqueOrThrow({
      where: { id: booking.roomId },
      select: { name: true, house: { select: { name: true } } },
    });
    const data = (locale: Locale): TemplateData => ({
      guestName: booking.guestName,
      houseName: pickText(room.house.name as LocalizedText, locale),
      roomName: pickText(room.name as LocalizedText, locale),
      moveIn: input.moveIn,
      lastNight: input.lastNight,
    });

    await sendEmail(deps.db, deps.email, {
      to: user.email,
      template: "request_received",
      locale: user.locale,
      data: { ...data(user.locale), bookingUrl: `${deps.appUrl}/${user.locale}/bookings/${booking.id}` },
      bookingId: booking.id,
    });
    for (const to of deps.adminEmails) {
      await sendEmail(deps.db, deps.email, {
        to,
        template: "admin_new_request",
        locale: "ko",
        data: { ...data("ko"), bookingUrl: `${deps.appUrl}/admin/bookings/${booking.id}` },
        bookingId: booking.id,
      });
    }
  } catch (e) {
    console.error("[guest] request notification failed", e);
  }

  return { bookingId: booking.id };
}
