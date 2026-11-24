import "server-only";
import { addDays, todayKST, type ISODate } from "@/domain/dates";
import { fromDbDate, toDbDate } from "@/server/bookings/availability";
import type { Db } from "@/server/db";

export type UsdKrwRate = { rate: number; date: ISODate; source: "frankfurter" | "cache" | "fallback" };

const SOURCE_URL = "https://api.frankfurter.app/latest?from=USD&to=KRW";
const MAX_CACHE_AGE_DAYS = 7;
const TIMEOUT_MS = 5000;

const validRate = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

async function fetchRate(f: typeof fetch): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await f(SOURCE_URL, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: { KRW?: unknown } };
    return validRate(body?.rates?.KRW);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The USD→KRW rate for today (KST): today's stored row, else one fetch from frankfurter.app
 * (stored), else the newest stored row from the last 7 days, else `FX_USD_KRW_FALLBACK`, else null
 * (callers then hide PayPal).
 */
export async function getUsdKrwRate(db: Db, now: Date, opts: { fetch?: typeof fetch } = {}): Promise<UsdKrwRate | null> {
  const today = todayKST(now);
  const pair = { base: "USD", quote: "KRW" };

  const stored = await db.fxRate.findUnique({ where: { base_quote_date: { ...pair, date: toDbDate(today) } } });
  if (stored) return { rate: Number(stored.rate), date: today, source: "cache" };

  const fetched = await fetchRate(opts.fetch ?? fetch);
  if (fetched !== null) {
    await db.fxRate.upsert({
      where: { base_quote_date: { ...pair, date: toDbDate(today) } },
      create: { ...pair, rate: fetched, date: toDbDate(today), source: "frankfurter" },
      update: {},
    });
    return { rate: fetched, date: today, source: "frankfurter" };
  }

  const recent = await db.fxRate.findFirst({
    where: { ...pair, date: { gte: toDbDate(addDays(today, -MAX_CACHE_AGE_DAYS)) } },
    orderBy: { date: "desc" },
  });
  if (recent) return { rate: Number(recent.rate), date: fromDbDate(recent.date), source: "cache" };

  const fallback = validRate(Number(process.env.FX_USD_KRW_FALLBACK || NaN));
  if (fallback !== null) return { rate: fallback, date: today, source: "fallback" };
  return null;
}
