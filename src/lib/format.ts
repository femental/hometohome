import type { ISODate } from "@/domain/dates";

const KST_OFFSET_MS = 9 * 3_600_000; // Korea has no DST; fixed UTC+9 (no Intl: ICU-independent).
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** `2027-03-02 12:00 (KST)` */
export function formatKST(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return (
    `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ` +
    `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())} (KST)`
  );
}

/** `₩1,300,000` */
export function formatKRW(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₩${digits}`;
}

/** en: `Mar 15, 2027` / ko: `2027년 3월 15일` */
export function formatDate(iso: ISODate, locale: "en" | "ko"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (locale === "ko") return `${y}년 ${m}월 ${d}일`;
  return `${MONTHS_EN[m - 1]} ${d}, ${y}`;
}
