import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { prisma } from "@/server/db";
import { getUsdKrwRate } from "@/server/fx/rates";
import { resetDb } from "./factories";

beforeEach(() => resetDb());
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const now = new Date("2027-03-01T03:00:00Z"); // KST 2027-03-01
const okFetch = (rate: unknown) => {
  const fn = vi.fn(async () => new Response(JSON.stringify({ base: "USD", rates: { KRW: rate } }), { status: 200 }));
  return fn as unknown as typeof fetch & typeof fn;
};
const failFetch = () => vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;

test("fetches once per KST day and caches", async () => {
  const f = okFetch(1380.5);
  const a = await getUsdKrwRate(prisma, now, { fetch: f });
  const b = await getUsdKrwRate(prisma, new Date("2027-03-01T14:00:00Z"), { fetch: f }); // still KST 3/1
  expect(a).toEqual({ rate: 1380.5, date: "2027-03-01", source: "frankfurter" });
  expect(b).toEqual({ rate: 1380.5, date: "2027-03-01", source: "cache" });
  expect(f).toHaveBeenCalledTimes(1);
  expect(await prisma.fxRate.count()).toBe(1);
});

test("API failure → most recent cached rate within 7 days", async () => {
  await getUsdKrwRate(prisma, new Date("2027-02-25T03:00:00Z"), { fetch: okFetch(1370) });
  const r = await getUsdKrwRate(prisma, now, { fetch: failFetch() });
  expect(r).toEqual({ rate: 1370, date: "2027-02-25", source: "cache" });
});

test("no cache within 7 days → env fallback; none → null", async () => {
  await getUsdKrwRate(prisma, new Date("2027-02-20T03:00:00Z"), { fetch: okFetch(1360) }); // 9 days old
  vi.stubEnv("FX_USD_KRW_FALLBACK", "1400");
  expect(await getUsdKrwRate(prisma, now, { fetch: failFetch() })).toEqual({
    rate: 1400,
    date: "2027-03-01",
    source: "fallback",
  });
  vi.stubEnv("FX_USD_KRW_FALLBACK", "");
  expect(await getUsdKrwRate(prisma, now, { fetch: failFetch() })).toBeNull();
});

test("malformed API response is treated as a failure", async () => {
  vi.stubEnv("FX_USD_KRW_FALLBACK", "");
  expect(await getUsdKrwRate(prisma, now, { fetch: okFetch("abc") })).toBeNull();
  expect(await getUsdKrwRate(prisma, now, { fetch: okFetch(-5) })).toBeNull();
  expect(await prisma.fxRate.count()).toBe(0);
});
