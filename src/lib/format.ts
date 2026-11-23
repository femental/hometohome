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

const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** `₩1,300,000` */
export function formatKRW(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₩${groupDigits(Math.abs(Math.round(n)))}`;
}

/** An amount in minor units of its currency: KRW `₩1,300,000`, USD `$123.45`. */
export function formatMinor(currency: string, minor: number): string {
  if (currency === "KRW") return formatKRW(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const units = `${groupDigits(Math.floor(abs / 100))}.${pad(abs % 100)}`;
  return currency === "USD" ? `${sign}$${units}` : `${sign}${units} ${currency}`;
}

/** Time left until `deadline`, for admin screens: `23시간 남음`, `40분 남음`, `기한 지남`. */
export function formatRemainingKo(deadline: Date, now: Date): string {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return "기한 지남";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}시간 남음`;
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 1 ? `${minutes}분 남음` : "1분 미만 남음";
}

/** en: `Mar 15, 2027` / ko: `2027년 3월 15일` */
export function formatDate(iso: ISODate, locale: "en" | "ko"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (locale === "ko") return `${y}년 ${m}월 ${d}일`;
  return `${MONTHS_EN[m - 1]} ${d}, ${y}`;
}
