/** Calendar date in `YYYY-MM-DD` form, interpreted in Korea Standard Time. */
export type ISODate = string;

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000; // Korea has no DST; fixed UTC+9.
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function isValidISODate(s: string): boolean {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo - 1);
}

function parse(d: ISODate): { y: number; m0: number; day: number } {
  if (!isValidISODate(d)) throw new Error(`Invalid ISODate: ${d}`);
  const [y, m, day] = d.split("-").map(Number);
  return { y, m0: m - 1, day };
}

/** UTC-midnight epoch ms for the calendar date. */
function toUtcMs(d: ISODate): number {
  const { y, m0, day } = parse(d);
  return Date.UTC(y, m0, day);
}

function fromUtcMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUtcMs(toUtcMs(d) + n * DAY_MS);
}

/** Adds months; if the target month lacks the day, clamps to its last day. */
export function addMonthsClamped(d: ISODate, months: number): ISODate {
  const { y, m0, day } = parse(d);
  const total = y * 12 + m0 + months;
  const ty = Math.floor(total / 12);
  const tm0 = total - ty * 12;
  const td = Math.min(day, daysInMonth(ty, tm0));
  return fromUtcMs(Date.UTC(ty, tm0, td));
}

/** `to - from` in whole days. */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function todayKST(now: Date): ISODate {
  return fromUtcMs(now.getTime() + KST_OFFSET_MS);
}

/** 00:00:00.000 KST of the given date. */
export function startOfDayKST(d: ISODate): Date {
  return new Date(toUtcMs(d) - KST_OFFSET_MS);
}

/** 23:59:59.999 KST of the given date. */
export function endOfDayKST(d: ISODate): Date {
  return new Date(toUtcMs(d) + DAY_MS - 1 - KST_OFFSET_MS);
}
