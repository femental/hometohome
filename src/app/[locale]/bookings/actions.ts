"use server";

import { hasLocale } from "next-intl";
import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import {
  guestBookingErrorKey,
  guestCancel,
  guestWithdraw,
  isBookingId,
  type CancelResult,
  type WithdrawResult,
} from "@/server/guest/bookings";

// Only the actions are exported: every export of a "use server" file is a public endpoint.
// Each starts with requireUser(); the services act on the caller's own bookings only and report
// anyone else's booking as NOT_FOUND.

/** Where login returns to: the booking page, built only from validated parts (never raw input). */
function bookingPath(bookingId: unknown, locale: unknown): string {
  const l = typeof locale === "string" && hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  return typeof bookingId === "string" && isBookingId(bookingId) ? `/${l}/bookings/${bookingId}` : `/${l}/bookings`;
}

/** The list and detail pages show the new status in the action's response (both locales). */
function revalidateBookings() {
  revalidatePath("/[locale]/bookings", "page");
  revalidatePath("/[locale]/bookings/[id]", "page");
}

/** Withdraws the caller's own pending request. */
export async function withdrawAction(bookingId: string, locale?: string): Promise<WithdrawResult> {
  const user = await requireUser(bookingPath(bookingId, locale));
  if (typeof bookingId !== "string" || !isBookingId(bookingId)) return { ok: false, error: "NOT_FOUND" };

  try {
    await guestWithdraw({ db: prisma, now: new Date() }, user.id, bookingId);
  } catch (e) {
    const error = guestBookingErrorKey(e);
    if (error === null) throw e;
    if (error !== "NOT_FOUND") revalidateBookings(); // e.g. it expired meanwhile: show the real status
    return { ok: false, error };
  }
  revalidateBookings();
  return { ok: true };
}

/** Cancels the caller's own confirmed booking after they saw the refund preview; returns the refund (KRW). */
export async function cancelAction(bookingId: string, locale?: string): Promise<CancelResult> {
  const user = await requireUser(bookingPath(bookingId, locale));
  if (typeof bookingId !== "string" || !isBookingId(bookingId)) return { ok: false, error: "NOT_FOUND" };

  let refundKrw: number;
  try {
    const env = serverEnv();
    ({ refundKrw } = await guestCancel(
      { db: prisma, email: defaultEmailSender(), now: new Date(), appUrl: env.APP_URL, adminEmails: env.ADMIN_EMAILS },
      user.id,
      bookingId,
    ));
  } catch (e) {
    const error = guestBookingErrorKey(e);
    if (error === null) throw e;
    if (error !== "NOT_FOUND") revalidateBookings();
    return { ok: false, error };
  }
  revalidateBookings();
  return { ok: true, refundKrw };
}
