import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// With Supabase env set, getUser() "refreshes" the session: setAll hands back a cookie + cache header.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[], h: Record<string, string>) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        opts.cookies.setAll([{ name: "sb-x", value: "v", options: {} }], { "cache-control": "private" });
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

import { proxy } from "@/proxy";

// No Supabase env: the proxy skips the session refresh and treats the visitor as anonymous.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

function location(res: Response): string | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const url = new URL(loc, "http://localhost:3000");
  return url.pathname + url.search;
}

test("/ with Accept-Language ko → /ko", async () => {
  const res = await proxy(request("/", { "accept-language": "ko-KR,ko;q=0.9,en;q=0.8" }));
  expect(res.status).toBe(307);
  expect(location(res)).toBe("/ko");
});

test("/ with Accept-Language en-US → /en", async () => {
  const res = await proxy(request("/", { "accept-language": "en-US,en;q=0.9" }));
  expect(location(res)).toBe("/en");
});

test("/ with an unsupported language → /en (default)", async () => {
  const res = await proxy(request("/", { "accept-language": "fr-FR,fr;q=0.9" }));
  expect(location(res)).toBe("/en");
});

test("a saved NEXT_LOCALE cookie wins over Accept-Language", async () => {
  const res = await proxy(request("/", { "accept-language": "en-US", cookie: "NEXT_LOCALE=ko" }));
  expect(location(res)).toBe("/ko");
});

test("unprefixed guest paths get a locale prefix", async () => {
  const res = await proxy(request("/bookings?x=1", { "accept-language": "ko" }));
  expect(location(res)).toBe("/ko/bookings?x=1");
});

test("localized paths pass through", async () => {
  for (const path of ["/en", "/ko/bookings"]) {
    const res = await proxy(request(path, { "accept-language": "en" }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  }
});

test("/admin is not localized (anonymous → /ko/login)", async () => {
  const res = await proxy(request("/admin/rooms", { "accept-language": "en" }));
  expect(location(res)).toBe("/ko/login?next=%2Fadmin%2Frooms");
});

test("refreshed Supabase cookies and cache headers land on redirects and pass-throughs", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  for (const path of ["/", "/en"]) {
    const res = await proxy(request(path, { "accept-language": "en" }));
    expect(res.headers.get("location") !== null, path).toBe(path === "/");
    expect(res.cookies.get("sb-x")?.value, path).toBe("v");
    expect(res.headers.get("cache-control"), path).toBe("private");
  }
});

test("/auth, /login, /api and files are left alone", async () => {
  for (const path of ["/auth/callback?code=x", "/login", "/api/health", "/robots.txt"]) {
    const res = await proxy(request(path, { "accept-language": "ko" }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  }
});

test("in production, missing Supabase env is a clear error instead of everyone signed out", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await expect(proxy(request("/en"))).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});
