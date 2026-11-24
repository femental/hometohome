"use server";

import { hasLocale } from "next-intl";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { toGuestErrorKey } from "@/server/guest/errors";
import {
  quoteInput,
  quoteRoom,
  requestInput,
  submitRequest,
  type QuoteResult,
  type SubmitRequestResult,
} from "@/server/guest/requests";
import { allowQuote, clientIp } from "@/server/rate-limit";

// Only the actions are exported: every export of a "use server" file is a public endpoint.
// Guest actions start with requireUser(); quoteAction is the one public exception (price preview).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (fd: FormData, key: string): string | undefined => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};

/** Page locale posted by the form; anything unexpected → default locale. */
function formLocale(fd: FormData) {
  const locale = str(fd, "locale");
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

/** Where login returns to: the room page, built only from validated parts (never raw input). */
function roomPath(fd: FormData): string {
  const locale = formLocale(fd);
  const roomId = str(fd, "roomId");
  return roomId && UUID_RE.test(roomId) ? `/${locale}/rooms/${roomId}` : `/${locale}`;
}

/** Public price preview (no account needed): validated input, published rooms only, server pricing. */
export async function quoteAction(input: {
  roomId: string;
  moveIn: string;
  lastNight: string;
  occupants: number;
}): Promise<QuoteResult> {
  const parsed = quoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const now = new Date();
  if (!(await allowQuote(prisma, clientIp(await headers()), now))) return { ok: false, error: "RATE_LIMITED" };
  return quoteRoom(prisma, parsed.data, now);
}

/** Submits a booking request, then redirects to the new booking. Failures come back as a GuestErrorKey. */
export async function submitRequestAction(formData: FormData): Promise<SubmitRequestResult> {
  const user = await requireUser(roomPath(formData));

  const parsed = requestInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "_form")))];
    return { ok: false, error: "VALIDATION", fields };
  }

  let bookingId: string;
  try {
    const env = serverEnv();
    ({ bookingId } = await submitRequest(
      { db: prisma, email: defaultEmailSender(), now: new Date(), appUrl: env.APP_URL, adminEmails: env.ADMIN_EMAILS },
      { id: user.id, email: user.email, locale: user.locale },
      parsed.data,
    ));
  } catch (e) {
    const error = toGuestErrorKey(e);
    if (error === null) throw e;
    return { ok: false, error };
  }
  redirect(`/${formLocale(formData)}/bookings/${bookingId}`);
}
