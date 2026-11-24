import "server-only";
import type { ISODate } from "@/domain/dates";
import { formatDate, formatKRW, formatKST } from "@/lib/format";

type Locale = "en" | "ko";

export type TemplateName =
  | "request_received"
  | "request_approved"
  | "request_rejected"
  | "request_expired"
  | "payment_expired"
  | "booking_confirmed"
  | "booking_cancelled"
  | "admin_new_request"
  | "admin_payment_received"
  | "admin_booking_cancelled"
  | "late_payment_refund"
  | "admin_late_payment_refund";

export interface TemplateData {
  guestName: string;
  houseName: string;
  roomName: string;
  moveIn: ISODate;
  lastNight: ISODate;
  firstPaymentTotal?: number;
  deposit?: number;
  holdExpiresAt?: Date;
  /** Last instant for a full refund (booking_confirmed). */
  cancellationDeadline?: Date;
  payUrl?: string;
  bookingUrl?: string;
  reason?: string;
  refundKrw?: number;
}

type Line = string | { link: { label: string; url: string } };
interface Content {
  subject: string;
  lines: Line[];
}

/** Values already formatted for the email's locale. */
interface View {
  guest: string;
  place: string; // "House · Room"
  stay: string; // "move-in ~ last night"
  moveIn: string;
  lastNight: string;
  total: string;
  deposit: string;
  deadline: string;
  refundDeadline: string;
  payUrl: string;
  bookingUrl: string;
  reason: string;
  refund: string;
  hasRefund: boolean;
}

type Field = Exclude<keyof TemplateData, "guestName" | "houseName" | "roomName" | "moveIn" | "lastNight">;

interface Template {
  need: Field[];
  /** Omitted for admin_* templates, which are always Korean. */
  en?: (v: View) => Content;
  ko: (v: View) => Content;
}

const link = (label: string, url: string): Line => ({ link: { label, url } });

const TEMPLATES: Record<TemplateName, Template> = {
  request_received: {
    need: [],
    en: (v) => ({
      subject: `We received your booking request – ${v.place}`,
      lines: [
        `Hi ${v.guest},`,
        `We received your request for ${v.place} (${v.stay}). The host will review it, and we will email you the result.`,
        "You will not be charged until your request is approved.",
      ],
    }),
    ko: (v) => ({
      subject: `예약 신청이 접수되었습니다 – ${v.place}`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} (${v.stay}) 예약 신청이 접수되었습니다. 호스트 검토 후 결과를 이메일로 알려드립니다.`,
        "승인되기 전에는 결제가 진행되지 않습니다.",
      ],
    }),
  },
  request_approved: {
    need: ["firstPaymentTotal", "holdExpiresAt", "payUrl"],
    en: (v) => ({
      subject: `Your request was approved – please pay by ${v.deadline}`,
      lines: [
        `Hi ${v.guest},`,
        `Good news! Your request for ${v.place} (${v.stay}) was approved.`,
        `Please pay within 24 hours, by ${v.deadline}, to confirm the booking. Amount due: ${v.total}. The room is held for you until then; after that the hold is released.`,
        link("Pay now", v.payUrl),
      ],
    }),
    ko: (v) => ({
      subject: `예약 신청이 승인되었습니다 – ${v.deadline}까지 결제해 주세요`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} (${v.stay}) 예약 신청이 승인되었습니다.`,
        `예약을 확정하려면 승인 후 24시간 이내(${v.deadline}까지) 결제해 주세요. 결제 금액: ${v.total}. 그때까지 방이 확보되며, 이후에는 자동으로 해제됩니다.`,
        link("결제하기", v.payUrl),
      ],
    }),
  },
  request_rejected: {
    need: [],
    en: (v) => ({
      subject: `About your booking request – ${v.place}`,
      lines: [
        `Hi ${v.guest},`,
        `Unfortunately we could not accept your request for ${v.place} (${v.stay}).`,
        ...(v.reason ? [`Reason: ${v.reason}`] : []),
        "You have not been charged. You are welcome to look for other rooms or dates.",
      ],
    }),
    ko: (v) => ({
      subject: `예약 신청 결과 안내 – ${v.place}`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `죄송하지만 ${v.place} (${v.stay}) 예약 신청을 수락하지 못했습니다.`,
        ...(v.reason ? [`사유: ${v.reason}`] : []),
        "결제된 금액은 없습니다. 다른 방이나 날짜를 확인해 주세요.",
      ],
    }),
  },
  request_expired: {
    need: [],
    en: (v) => ({
      subject: `Your booking request expired – ${v.place}`,
      lines: [
        `Hi ${v.guest},`,
        `Your request for ${v.place} (${v.stay}) expired because it was not reviewed in time. You have not been charged.`,
        "Please submit a new request if you are still interested.",
      ],
    }),
    ko: (v) => ({
      subject: `예약 신청이 만료되었습니다 – ${v.place}`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} (${v.stay}) 예약 신청이 기한 내 검토되지 않아 만료되었습니다. 결제된 금액은 없습니다.`,
        "계속 원하시면 새로 신청해 주세요.",
      ],
    }),
  },
  payment_expired: {
    need: [],
    en: (v) => ({
      subject: `Payment deadline passed – ${v.place}`,
      lines: [
        `Hi ${v.guest},`,
        `We did not receive payment for ${v.place} (${v.stay}) by the deadline, so the room is no longer held for you.`,
        "Please submit a new request if you would still like to book.",
      ],
    }),
    ko: (v) => ({
      subject: `결제 기한이 지났습니다 – ${v.place}`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} (${v.stay}) 결제가 기한 내 확인되지 않아 방 확보가 해제되었습니다.`,
        "계속 원하시면 새로 신청해 주세요.",
      ],
    }),
  },
  booking_confirmed: {
    need: ["firstPaymentTotal", "deposit", "cancellationDeadline"],
    en: (v) => ({
      subject: `Booking confirmed – ${v.place}`,
      lines: [
        `Hi ${v.guest},`,
        `Your booking for ${v.place} is confirmed.`,
        `Move-in: ${v.moveIn}`,
        `Last night: ${v.lastNight}`,
        `Amount paid: ${v.total} (includes a deposit of ${v.deposit})`,
        `Full refund if cancelled by ${v.refundDeadline} (7 days before move-in); after that only the deposit is refunded; no online cancellation from move-in day.`,
        ...(v.bookingUrl ? [link("View your booking", v.bookingUrl)] : []),
      ],
    }),
    ko: (v) => ({
      subject: `예약이 확정되었습니다 – ${v.place}`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} 예약이 확정되었습니다.`,
        `입주일: ${v.moveIn}`,
        `마지막 숙박일: ${v.lastNight}`,
        `결제 금액: ${v.total} (보증금 ${v.deposit} 포함)`,
        `${v.refundDeadline}까지 취소하면 전액 환불됩니다(입주 7일 전). 그 이후에는 보증금만 환불되며, 입주일부터는 온라인 취소가 불가능합니다.`,
        ...(v.bookingUrl ? [link("예약 확인하기", v.bookingUrl)] : []),
      ],
    }),
  },
  booking_cancelled: {
    need: [],
    en: (v) => ({
      subject: `Booking cancelled – ${v.place}`,
      lines: [
        `Hi ${v.guest},`,
        `Your booking for ${v.place} (${v.stay}) has been cancelled.`,
        ...(v.reason ? [`Reason: ${v.reason}`] : []),
        ...(v.hasRefund ? [`A refund of ${v.refund} will be processed.`] : ["No refund applies to this booking."]),
      ],
    }),
    ko: (v) => ({
      subject: `예약이 취소되었습니다 – ${v.place}`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} (${v.stay}) 예약이 취소되었습니다.`,
        ...(v.reason ? [`사유: ${v.reason}`] : []),
        ...(v.hasRefund ? [`${v.refund} 환불이 진행됩니다.`] : ["환불 대상 금액이 없습니다."]),
      ],
    }),
  },
  late_payment_refund: {
    need: ["refundKrw"],
    en: (v) => ({
      subject: `Your payment arrived after the hold expired – refund in progress`,
      lines: [
        `Hi ${v.guest},`,
        `We received your payment for ${v.place} (${v.stay}) after the 24-hour payment window had expired, so the booking was not confirmed.`,
        `A full refund of ${v.refund} is being processed.`,
        "You are welcome to submit a new request if you would still like to book.",
      ],
    }),
    ko: (v) => ({
      subject: `결제가 기한 후 도착했습니다 – 환불이 진행됩니다`,
      lines: [
        `${v.guest}님, 안녕하세요.`,
        `${v.place} (${v.stay}) 결제가 24시간 결제 기한이 지난 뒤 도착하여 예약이 확정되지 않았습니다.`,
        `결제하신 ${v.refund} 전액 환불이 진행됩니다.`,
        "계속 원하시면 새로 신청해 주세요.",
      ],
    }),
  },
  admin_new_request: {
    need: [],
    ko: (v) => ({
      subject: `[운영] 새 예약 신청 – ${v.place}`,
      lines: [
        `${v.guest}님이 ${v.place} (${v.stay}) 예약을 신청했습니다.`,
        ...(v.bookingUrl ? [link("관리자 화면에서 보기", v.bookingUrl)] : []),
      ],
    }),
  },
  admin_payment_received: {
    need: ["firstPaymentTotal"],
    ko: (v) => ({
      subject: `[운영] 결제 완료 – ${v.place}`,
      lines: [
        `${v.guest}님이 ${v.place} (${v.stay}) 결제를 완료했습니다. 금액: ${v.total}`,
        ...(v.bookingUrl ? [link("관리자 화면에서 보기", v.bookingUrl)] : []),
      ],
    }),
  },
  admin_booking_cancelled: {
    need: [],
    ko: (v) => ({
      subject: `[운영] 예약 취소 – ${v.place}`,
      lines: [
        `${v.guest}님의 ${v.place} (${v.stay}) 예약이 취소되었습니다.`,
        ...(v.reason ? [`사유: ${v.reason}`] : []),
        ...(v.refund ? [`환불 금액: ${v.refund}`] : []),
        ...(v.bookingUrl ? [link("관리자 화면에서 보기", v.bookingUrl)] : []),
      ],
    }),
  },
  admin_late_payment_refund: {
    need: ["refundKrw"],
    ko: (v) => ({
      subject: `[운영] 기한 후 결제 자동 환불 – ${v.place}`,
      lines: [
        `${v.guest}님이 ${v.place} (${v.stay}) 결제 기한이 지난 뒤 결제하여 자동으로 환불 처리했습니다. 환불 금액: ${v.refund}`,
        ...(v.bookingUrl ? [link("관리자 화면에서 보기", v.bookingUrl)] : []),
      ],
    }),
  },
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function buildView(locale: Locale, d: TemplateData): View {
  const moveIn = formatDate(d.moveIn, locale);
  const lastNight = formatDate(d.lastNight, locale);
  return {
    guest: d.guestName,
    place: `${d.houseName} · ${d.roomName}`,
    stay: `${moveIn} ~ ${lastNight}`,
    moveIn,
    lastNight,
    total: d.firstPaymentTotal === undefined ? "" : formatKRW(d.firstPaymentTotal),
    deposit: d.deposit === undefined ? "" : formatKRW(d.deposit),
    deadline: d.holdExpiresAt ? formatKST(d.holdExpiresAt) : "",
    refundDeadline: d.cancellationDeadline ? formatKST(d.cancellationDeadline) : "",
    payUrl: d.payUrl ?? "",
    bookingUrl: d.bookingUrl ?? "",
    reason: d.reason ?? "",
    refund: d.refundKrw === undefined ? "" : formatKRW(d.refundKrw),
    hasRefund: (d.refundKrw ?? 0) > 0,
  };
}

export function renderEmail(
  name: TemplateName,
  locale: Locale,
  data: TemplateData,
): { subject: string; text: string; html: string } {
  const tpl = TEMPLATES[name];
  const missing = tpl.need.filter((f) => data[f] === undefined);
  if (missing.length > 0) throw new Error(`Template ${name} is missing data: ${missing.join(", ")}`);

  const { subject, lines } = (tpl[locale] ?? tpl.ko)(buildView(locale, data));

  const text = lines.map((l) => (typeof l === "string" ? l : `${l.link.label}: ${l.link.url}`)).join("\n\n");
  const body = lines
    .map((l) =>
      typeof l === "string"
        ? `<p style="margin:0 0 16px">${escapeHtml(l)}</p>`
        : `<p style="margin:0 0 16px"><a href="${escapeHtml(l.link.url)}" style="display:inline-block;padding:10px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(l.link.label)}</a></p>`,
    )
    .join("");
  const html =
    `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:560px;margin:0 auto;padding:24px">` +
    `<h1 style="font-size:18px;margin:0 0 20px">${escapeHtml(subject)}</h1>${body}</div>`;

  return { subject, text, html };
}
