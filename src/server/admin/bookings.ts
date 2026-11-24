import "server-only";
import type { Booking, Prisma, Refund } from "@/generated/prisma/client";
import { effectiveStatus, type BookingStatus } from "@/domain/booking-status";
import { addDays, addMonthsClamped, todayKST, type ISODate } from "@/domain/dates";
import { proportionalRefundMinor } from "@/domain/fx";
import { cancellationDeadline, decideRefund, type RefundDecision } from "@/domain/refund";
import { fromDbDate, toDbDate } from "@/server/bookings/availability";
import { BookingError } from "@/server/bookings/errors";
import {
  approveRequest,
  cancelBooking,
  confirmOfflinePayment,
  markCompleted,
  markDepositReturned,
  rejectRequest,
  type CancelActor,
} from "@/server/bookings/service";
import type { Db } from "@/server/db";
import { sendEmail } from "@/server/email/send";
import type { EmailSender } from "@/server/email/sender";
import type { TemplateData, TemplateName } from "@/server/email/templates";
import { sendRefundNotice } from "@/server/payments/refunds";

export interface Deps {
  db: Db;
  email: EmailSender;
  now: Date;
  appUrl: string;
  adminEmails: string[];
}

type Locale = "en" | "ko";
type LocalizedName = { en: string; ko?: string };

const AUTO_REJECT_REASON: Record<Locale, string> = {
  ko: "다른 신청이 확정되었습니다",
  en: "Another request for these dates was confirmed",
};

const toLocale = (v: string): Locale => (v === "ko" ? "ko" : "en");
const pickName = (n: unknown, locale: Locale): string => {
  const o = n as LocalizedName;
  return (locale === "ko" ? o.ko : undefined) ?? o.en;
};
/** Moves out on `moveOut`, so the last night is the day before. */
const lastNightOf = (b: { moveOut: Date }): ISODate => addDays(fromDbDate(b.moveOut), -1);

const bookingWithParties = {
  guest: true,
  room: { include: { house: true } },
} satisfies Prisma.BookingInclude;
type BookingWithParties = Prisma.BookingGetPayload<{ include: typeof bookingWithParties }>;

// ---------------------------------------------------------------------------
// Emails (always sent after the service call committed; never affect the result)

function emailData(b: BookingWithParties, locale: Locale, extra: Partial<TemplateData> = {}): TemplateData {
  return {
    guestName: b.guestName,
    houseName: pickName(b.room.house.name, locale),
    roomName: pickName(b.room.name, locale),
    moveIn: fromDbDate(b.moveIn),
    lastNight: lastNightOf(b),
    ...extra,
  };
}

async function notify(d: Deps, bookingIds: string[], fn: (b: BookingWithParties) => Promise<unknown>) {
  for (const id of bookingIds) {
    try {
      const b = await d.db.booking.findUnique({ where: { id }, include: bookingWithParties });
      if (b) await fn(b);
    } catch (e) {
      console.error("[admin] notification failed", e);
    }
  }
}

function toGuest(d: Deps, b: BookingWithParties, template: TemplateName, extra: Partial<TemplateData> = {}) {
  const locale = toLocale(b.guest.locale);
  return sendEmail(d.db, d.email, {
    to: b.guest.email,
    template,
    locale,
    data: emailData(b, locale, extra),
    bookingId: b.id,
  });
}

// ---------------------------------------------------------------------------
// Commands

export async function adminApprove(d: Deps, bookingId: string): Promise<Booking> {
  const booking = await approveRequest(d.db, bookingId, d.now);
  await notify(d, [bookingId], (b) => {
    const locale = toLocale(b.guest.locale);
    return toGuest(d, b, "request_approved", {
      payUrl: `${d.appUrl}/${locale}/bookings/${b.id}/pay`,
      holdExpiresAt: booking.holdExpiresAt ?? undefined,
      firstPaymentTotal: b.firstPaymentTotal,
    });
  });
  return booking;
}

export async function adminReject(d: Deps, bookingId: string, reason: string): Promise<Booking> {
  const booking = await rejectRequest(d.db, bookingId, reason, d.now);
  await notify(d, [bookingId], (b) => toGuest(d, b, "request_rejected", { reason }));
  return booking;
}

export async function adminConfirmOffline(
  d: Deps,
  bookingId: string,
  p: { method: "bank_transfer" | "cash" | "other"; amountKrw: number; note: string },
): Promise<{ autoRejectedIds: string[] }> {
  const { autoRejectedIds } = await confirmOfflinePayment(d.db, bookingId, p, d.now);
  await notify(d, [bookingId], (b) => {
    const locale = toLocale(b.guest.locale);
    return toGuest(d, b, "booking_confirmed", {
      bookingUrl: `${d.appUrl}/${locale}/bookings/${b.id}`,
      firstPaymentTotal: b.firstPaymentTotal,
      deposit: b.deposit,
      cancellationDeadline: cancellationDeadline(fromDbDate(b.moveIn)),
    });
  });
  await notify(d, autoRejectedIds, (b) =>
    toGuest(d, b, "request_rejected", { reason: AUTO_REJECT_REASON[toLocale(b.guest.locale)] }),
  );
  return { autoRejectedIds };
}

export async function adminCancel(d: Deps, bookingId: string): Promise<{ refundIds: string[] }> {
  const { refund, refundIds } = await cancelBooking(d.db, bookingId, { kind: "admin" }, d.now);
  await notify(d, [bookingId], async (b) => {
    await toGuest(d, b, "booking_cancelled", { refundKrw: refund.amountKrw });
    for (const to of d.adminEmails) {
      await sendEmail(d.db, d.email, {
        to,
        template: "admin_booking_cancelled",
        locale: "ko",
        data: emailData(b, "ko", {
          bookingUrl: `${d.appUrl}/admin/bookings/${b.id}`,
          ...(refund.amountKrw > 0 ? { refundKrw: refund.amountKrw } : {}),
        }),
        bookingId: b.id,
      });
    }
  });
  return { refundIds };
}

/** Marks a manual (offline) pending refund as paid out and mails the guest `refund_completed`. */
export async function adminMarkRefundDone(d: Deps, refundId: string): Promise<Refund> {
  const { count } = await d.db.refund.updateMany({
    where: { id: refundId, manual: true, status: "pending" },
    data: { status: "done" },
  });
  if (count === 0) throw new BookingError("INVALID_STATE", "refund is not a pending manual refund");
  await sendRefundNotice(d, refundId, "completed");
  return d.db.refund.findUniqueOrThrow({ where: { id: refundId } });
}

export const adminComplete = (db: Db, bookingId: string, now: Date) => markCompleted(db, bookingId, now);

export const adminDepositReturned = (db: Db, bookingId: string, note: string, now: Date) =>
  markDepositReturned(db, bookingId, note, now);

// ---------------------------------------------------------------------------
// Queries

export type AdminBookingRow = {
  id: string;
  status: BookingStatus;
  guestName: string;
  guestEmail: string;
  houseName: string;
  roomName: string;
  moveIn: ISODate;
  lastNight: ISODate;
  firstPaymentTotal: number;
  requestExpiresAt: Date | null;
  holdExpiresAt: Date | null;
};

function toRow(b: BookingWithParties, now: Date): AdminBookingRow {
  return {
    id: b.id,
    status: effectiveStatus(b, now),
    guestName: b.guestName,
    guestEmail: b.guest.email,
    houseName: pickName(b.room.house.name, "ko"),
    roomName: pickName(b.room.name, "ko"),
    moveIn: fromDbDate(b.moveIn),
    lastNight: lastNightOf(b),
    firstPaymentTotal: b.firstPaymentTotal,
    requestExpiresAt: b.requestExpiresAt,
    holdExpiresAt: b.holdExpiresAt,
  };
}

/** Requests still awaiting a decision, soonest expiry first. */
export async function listRequests(db: Db, now: Date): Promise<AdminBookingRow[]> {
  const rows = await db.booking.findMany({
    where: { status: "requested", OR: [{ requestExpiresAt: null }, { requestExpiresAt: { gt: now } }] },
    include: bookingWithParties,
    orderBy: [{ requestExpiresAt: "asc" }, { requestedAt: "asc" }],
  });
  return rows.map((b) => toRow(b, now)).filter((r) => r.status === "requested");
}

const LIST_LIMIT = 200;

/** Stored statuses that can read as one of the given effective statuses (expiry is applied at read time). */
function storedStatusesFor(effective: BookingStatus[]): BookingStatus[] {
  const stored = new Set<BookingStatus>();
  for (const s of effective) {
    stored.add(s);
    if (s === "payment_expired") stored.add("awaiting_payment");
    if (s === "request_expired") stored.add("requested");
  }
  return [...stored];
}

/** Latest move-in first, at most 200 rows. `status` matches the effective (read-time) status; `from`/`to` bound the move-in date. */
export async function listBookings(
  db: Db,
  f: { status?: BookingStatus[]; roomId?: string; from?: ISODate; to?: ISODate },
  now: Date,
): Promise<AdminBookingRow[]> {
  const rows = await db.booking.findMany({
    where: {
      ...(f.status ? { status: { in: storedStatusesFor(f.status) } } : {}),
      ...(f.roomId ? { roomId: f.roomId } : {}),
      ...(f.from || f.to
        ? { moveIn: { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) } }
        : {}),
    },
    include: bookingWithParties,
    orderBy: [{ moveIn: "desc" }, { id: "asc" }],
    take: LIST_LIMIT,
  });
  const mapped = rows.map((b) => toRow(b, now));
  return f.status ? mapped.filter((r) => f.status!.includes(r.status)) : mapped;
}

export type AdminBookingDetail = Omit<
  Booking,
  "moveIn" | "moveOut" | "status"
> & {
  status: BookingStatus;
  storedStatus: BookingStatus;
  moveIn: ISODate;
  moveOut: ISODate;
  lastNight: ISODate;
  guest: { id: string; email: string; name: string; locale: string };
  house: { id: string; name: string };
  room: { id: string; name: string };
  payments: {
    id: string;
    method: string;
    currency: string;
    amountKrw: number;
    amountChargedMinor: number;
    fxRate: string | null;
    status: string;
    offlineNote: string | null;
    pgTxId: string | null;
    paidAt: Date | null;
    createdAt: Date;
    refunds: Refund[];
  }[];
  emailLogs: { id: string; toEmail: string; template: string; subject: string | null; status: string; error: string | null; createdAt: Date }[];
};

export async function getBookingDetail(db: Db, id: string, now: Date): Promise<AdminBookingDetail | null> {
  const b = await db.booking.findUnique({
    where: { id },
    include: {
      guest: true,
      room: { include: { house: true } },
      payments: { include: { refunds: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!b) return null;
  const emailLogs = await db.emailLog.findMany({ where: { bookingId: id }, orderBy: { createdAt: "asc" } });

  const { guest, room, payments, ...booking } = b;
  return {
    ...booking,
    storedStatus: b.status,
    status: effectiveStatus(b, now),
    moveIn: fromDbDate(b.moveIn),
    moveOut: fromDbDate(b.moveOut),
    lastNight: lastNightOf(b),
    guest: { id: guest.id, email: guest.email, name: guest.name, locale: guest.locale },
    house: { id: room.house.id, name: pickName(room.house.name, "ko") },
    room: { id: room.id, name: pickName(room.name, "ko") },
    payments: payments.map((p) => ({
      id: p.id,
      method: p.method,
      currency: p.currency,
      amountKrw: p.amountKrw,
      amountChargedMinor: p.amountChargedMinor,
      fxRate: p.fxRate === null ? null : p.fxRate.toString(),
      status: p.status,
      offlineNote: p.offlineNote,
      pgTxId: p.pgTxId,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      refunds: p.refunds,
    })),
    emailLogs: emailLogs.map((l) => ({
      id: l.id,
      toEmail: l.toEmail,
      template: l.template,
      subject: l.subject,
      status: l.status,
      error: l.error,
      createdAt: l.createdAt,
    })),
  };
}

export async function dashboardCounts(
  db: Db,
  now: Date,
): Promise<{
  pendingRequests: number;
  awaitingPayment: number;
  moveInsThisMonth: number;
  moveOutsThisMonth: number;
  manualRefundsPending: number;
  failedRefunds: number;
}> {
  const monthStart = `${todayKST(now).slice(0, 7)}-01`;
  const month = { gte: toDbDate(monthStart), lt: toDbDate(addMonthsClamped(monthStart, 1)) };
  const stays = { in: ["confirmed", "completed"] as BookingStatus[] };

  const [pendingRequests, awaitingPayment, moveInsThisMonth, moveOutsThisMonth, manualRefundsPending, failedRefunds] =
    await Promise.all([
      db.booking.count({
        where: { status: "requested", OR: [{ requestExpiresAt: null }, { requestExpiresAt: { gt: now } }] },
      }),
      db.booking.count({
        where: { status: "awaiting_payment", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
      }),
      db.booking.count({ where: { status: stays, moveIn: month } }),
      db.booking.count({ where: { status: stays, moveOut: month } }),
      db.refund.count({ where: { manual: true, status: "pending" } }),
      db.refund.count({ where: { manual: false, status: "failed" } }),
    ]);
  return { pendingRequests, awaitingPayment, moveInsThisMonth, moveOutsThisMonth, manualRefundsPending, failedRefunds };
}
