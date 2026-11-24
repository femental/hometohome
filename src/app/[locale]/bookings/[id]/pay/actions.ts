"use server";

import { hasLocale } from "next-intl";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { requireUser } from "@/server/auth/guest";
import { BookingError } from "@/server/bookings/errors";
import { prisma } from "@/server/db";
import { isBookingId } from "@/server/guest/bookings";
import { payDeps } from "@/server/payments/deps";
import {
  completePayment,
  PaymentFlowError,
  preparePayment,
  type CompleteOutcome,
  type PreparedPayment,
} from "@/server/payments/service";

// Only the actions are exported: every export of a "use server" file is a public endpoint.

export type PrepareResult =
  | { ok: true; payment: PreparedPayment }
  | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" | "CHANNEL_UNAVAILABLE" | "FX_UNAVAILABLE" | "VALIDATION" };

export type CompleteResult = { ok: true; outcome: CompleteOutcome } | { ok: false; error: "NOT_FOUND" };

const methodSchema = z.enum(["card", "paypal"]);
const uuid = z.uuid();

function localeOf(locale: unknown): "en" | "ko" {
  return typeof locale === "string" && hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

function payPath(bookingId: unknown, locale: unknown): string {
  const l = localeOf(locale);
  return typeof bookingId === "string" && isBookingId(bookingId) ? `/${l}/bookings/${bookingId}/pay` : `/${l}/bookings`;
}

/** Creates the server-side payment row for the caller's own live hold; returns what the checkout needs. */
export async function preparePaymentAction(bookingId: string, method: string, locale?: string): Promise<PrepareResult> {
  const user = await requireUser(payPath(bookingId, locale));
  const m = methodSchema.safeParse(method);
  if (!uuid.safeParse(bookingId).success || !m.success) return { ok: false, error: "VALIDATION" };
  const deps = payDeps();
  if (!deps) return { ok: false, error: "CHANNEL_UNAVAILABLE" };
  try {
    return { ok: true, payment: await preparePayment(deps, user.id, bookingId, m.data, localeOf(locale)) };
  } catch (e) {
    if (e instanceof PaymentFlowError) return { ok: false, error: e.code };
    if (e instanceof BookingError) return { ok: false, error: e.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE" };
    throw e;
  }
}

/** Verifies a finished checkout with the PG; only for a payment on the caller's own booking. */
export async function completePaymentAction(paymentId: string, locale?: string): Promise<CompleteResult> {
  const user = await requireUser(`/${localeOf(locale)}/bookings`);
  if (!uuid.safeParse(paymentId).success) return { ok: false, error: "NOT_FOUND" };
  const own = await prisma.payment.count({ where: { id: paymentId, booking: { guestId: user.id } } });
  if (own === 0) return { ok: false, error: "NOT_FOUND" };
  const deps = payDeps();
  if (!deps) return { ok: false, error: "NOT_FOUND" };
  const { outcome } = await completePayment(deps, paymentId);
  revalidatePath("/[locale]/bookings", "page");
  revalidatePath("/[locale]/bookings/[id]", "page");
  return { ok: true, outcome };
}
