import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "@/server/db";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Fixed-window counter in Postgres: one upsert per call. Returns true while the window's count is
 * within `limit`. Only a sha256 of `key` is stored, so emails and IPs never land in the table.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number, now: Date): Promise<boolean> {
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${hash(key)}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  return rows[0].count <= limit;
}

/** Magic link e-mails: 5 per address and 20 per IP, per hour. Both counters advance on every call. */
export async function allowMagicLink(db: Db, who: { email: string; ip: string }, now: Date): Promise<boolean> {
  const byEmail = await rateLimit(db, `magic:email:${who.email.trim().toLowerCase()}`, 5, 3600, now);
  const byIp = await rateLimit(db, `magic:ip:${who.ip}`, 20, 3600, now);
  return byEmail && byIp;
}

/** Public price preview: 120 per IP per minute. */
export function allowQuote(db: Db, ip: string, now: Date): Promise<boolean> {
  return rateLimit(db, `quote:ip:${ip}`, 120, 60, now);
}

/** Daily: drops windows that ended more than a day ago. Returns the number of rows deleted. */
export async function cleanupRateLimits(db: Db, now: Date): Promise<number> {
  const { count } = await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 86400_000) } } });
  return count;
}

/** The caller's IP as Vercel reports it (first `x-forwarded-for` value), or "unknown". */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
