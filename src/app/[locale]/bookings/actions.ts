"use server";

import { hasLocale } from "next-intl";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { payDeps } from "@/server/payments/deps";
import { runRefunds } from "@/server/payments/refunds";
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

const expectedKind = z.enum(["full", "deposit_only"]);

/**
 * Cancels the caller's own confirmed booking with the refund kind they saw in the preview; returns
 * the refund (KRW). If the refund changed since (REFUND_CHANGED), nothing is written and the page
 * re-renders with the new preview for the guest to confirm again.
 */
export async function cancelAction(
  bookingId: string,
  expected: "full" | "deposit_only",
  locale?: string,
): Promise<CancelResult> {
  const user = await requireUser(bookingPath(bookingId, locale));
  if (typeof bookingId !== "string" || !isBookingId(bookingId)) return { ok: false, error: "NOT_FOUND" };
  const kind = expectedKind.safeParse(expected);
  if (!kind.success) return { ok: false, error: "VALIDATION" };

  let refundKrw: number;
  let refundIds: string[];
  try {
    const env = serverEnv();
    ({ refundKrw, refundIds } = await guestCancel(
      { db: prisma, email: defaultEmailSender(), now: new Date(), appUrl: env.APP_URL, adminEmails: env.ADMIN_EMAILS },
      user.id,
      bookingId,
      kind.data,
    ));
  } catch (e) {
    const error = guestBookingErrorKey(e);
    if (error === null) throw e;
    if (error !== "NOT_FOUND") revalidateBookings();
    return { ok: false, error };
  }
  // The cancellation is committed; card/PayPal refunds go to the PG now (a failure alerts the operator).
  // If running the refund throws, the cancellation still stands; the row waits for an operator retry.
  const pd = payDeps();
  if (pd) await runRefunds(pd, refundIds).catch((e) => console.error("[guest] refund execution failed", e));
  revalidateBookings();
  return { ok: true, refundKrw };
}
