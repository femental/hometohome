import { beforeEach, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { allowMagicLink, allowQuote, cleanupRateLimits, rateLimit } from "@/server/rate-limit";
import { resetDb } from "./factories";

const T0 = new Date("2027-01-10T03:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => resetDb());

test("allows up to the limit in a window, refuses after, resets in the next window", async () => {
  for (let i = 0; i < 3; i++) expect(await rateLimit(prisma, "k", 3, 60, at(i * 1000))).toBe(true);
  expect(await rateLimit(prisma, "k", 3, 60, at(5000))).toBe(false);
  expect(await rateLimit(prisma, "other", 3, 60, at(5000))).toBe(true);
  expect(await rateLimit(prisma, "k", 3, 60, at(60_000))).toBe(true);
});

test("keys are stored hashed, not raw emails or IPs", async () => {
  await rateLimit(prisma, "email:guest@example.com", 5, 3600, T0);
  await allowMagicLink(prisma, { email: "Guest@Example.com", ip: "203.0.113.9" }, T0);
  const rows = await prisma.rateLimit.findMany();
  expect(rows.length).toBe(3);
  for (const r of rows) {
    expect(r.key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.key).not.toContain("example");
  }
});

test("magic link: 5 per email per hour, 20 per IP per hour", async () => {
  for (let i = 0; i < 5; i++) expect(await allowMagicLink(prisma, { email: "a@x.com", ip: "1.1.1.1" }, at(i))).toBe(true);
  expect(await allowMagicLink(prisma, { email: "A@x.com", ip: "1.1.1.2" }, at(10))).toBe(false);
  expect(await allowMagicLink(prisma, { email: "a@x.com", ip: "1.1.1.1" }, at(3600_000))).toBe(true);

  for (let i = 0; i < 20; i++) expect(await allowMagicLink(prisma, { email: `u${i}@y.com`, ip: "9.9.9.9" }, at(i))).toBe(true);
  expect(await allowMagicLink(prisma, { email: "new@y.com", ip: "9.9.9.9" }, at(30))).toBe(false);
});

test("quote: 120 per IP per minute", async () => {
  for (let i = 0; i < 120; i++) expect(await allowQuote(prisma, "5.5.5.5", T0)).toBe(true);
  expect(await allowQuote(prisma, "5.5.5.5", T0)).toBe(false);
  expect(await allowQuote(prisma, "5.5.5.6", T0)).toBe(true);
});

test("cleanup removes windows older than a day", async () => {
  await rateLimit(prisma, "old", 5, 60, at(-2 * 86400_000));
  await rateLimit(prisma, "new", 5, 60, T0);
  expect(await cleanupRateLimits(prisma, T0)).toBe(1);
  expect(await prisma.rateLimit.count()).toBe(1);
});
