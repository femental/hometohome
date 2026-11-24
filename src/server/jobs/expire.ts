import "server-only";
import { addDays } from "@/domain/dates";
import { fromDbDate } from "@/server/bookings/availability";
import { expireDue } from "@/server/bookings/service";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { EmailSender } from "@/server/email/sender";
import type { TemplateData, TemplateName } from "@/server/email/templates";

export interface JobDeps {
  db: Db;
  email: EmailSender;
  now: Date;
  appUrl: string;
  adminEmails: string[];
}

type Locale = "en" | "ko";
const BATCH = 200;
const REMINDER_LEAD_MS = 3 * 3600_000;
const NOTICE_LOOKBACK_MS = 7 * 24 * 3600_000;

const pick = (n: unknown, locale: Locale) => {
  const o = n as { en: string; ko?: string };
  return (locale === "ko" && o.ko ? o.ko : undefined) ?? o.en;
};

async function mailGuest(d: JobDeps, bookingId: string, template: TemplateName, extra: (locale: Locale) => Partial<TemplateData> = () => ({})) {
  try {
    const b = await d.db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { guest: true, room: { include: { house: true } } },
    });
    const locale: Locale = b.guest.locale === "ko" ? "ko" : "en";
    await sendEmail(d.db, d.email, {
      to: b.guest.email,
      template,
      locale,
      data: {
        guestName: b.guestName,
        houseName: pick(b.room.house.name, locale),
        roomName: pick(b.room.name, locale),
        moveIn: fromDbDate(b.moveIn),
        lastNight: addDays(fromDbDate(b.moveOut), -1),
        firstPaymentTotal: b.firstPaymentTotal,
        holdExpiresAt: b.holdExpiresAt ?? undefined,
        ...extra(locale),
      },
      bookingId,
    });
  } catch (e) {
    console.error(`[jobs] ${template} for ${bookingId} failed`, e);
  }
}

/** Claims a notice (sets the column once) so concurrent runs send it at most once. */
async function claim(d: JobDeps, id: string, column: "expiryNoticeSentAt" | "paymentReminderSentAt"): Promise<boolean> {
  const { count } = await d.db.booking.updateMany({ where: { id, [column]: null }, data: { [column]: d.now } });
  return count === 1;
}

/**
 * Persists expired requests and payment holds, then sends each guest its expiry notice once —
 * also for bookings another path already marked expired (read-time expiry), within the last 7 days.
 */
export async function runExpiry(d: JobDeps): Promise<{ requestExpired: string[]; paymentExpired: string[] }> {
  const expired = await expireDue(d.db, d.now);
  const since = new Date(d.now.getTime() - NOTICE_LOOKBACK_MS);
  const pending = await d.db.booking.findMany({
    where: {
      expiryNoticeSentAt: null,
      OR: [
        { status: "request_expired", requestExpiresAt: { gte: since } },
        { status: "payment_expired", holdExpiresAt: { gte: since } },
      ],
    },
    select: { id: true, status: true },
    take: BATCH,
  });
  for (const b of pending) {
    if (!(await claim(d, b.id, "expiryNoticeSentAt"))) continue;
    await mailGuest(d, b.id, b.status === "request_expired" ? "request_expired" : "payment_expired");
  }
  return expired;
}

/** Reminds guests whose live payment hold ends within 3 hours (once per booking). */
export async function runPaymentReminders(d: JobDeps): Promise<string[]> {
  const due = await d.db.booking.findMany({
    where: {
      status: "awaiting_payment",
      paymentReminderSentAt: null,
      holdExpiresAt: { gt: d.now, lte: new Date(d.now.getTime() + REMINDER_LEAD_MS) },
    },
    select: { id: true },
    orderBy: { holdExpiresAt: "asc" },
    take: BATCH,
  });
  const sent: string[] = [];
  for (const { id } of due) {
    if (!(await claim(d, id, "paymentReminderSentAt"))) continue;
    await mailGuest(d, id, "payment_reminder", (locale) => ({ payUrl: `${d.appUrl}/${locale}/bookings/${id}/pay` }));
    sent.push(id);
  }
  return sent;
}
