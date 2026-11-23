import { NextRequest } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";

const sb = vi.hoisted(() => ({
  auth: {
    verifyOtp: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
  },
}));
const sync = vi.hoisted(() => ({ syncUser: vi.fn() }));

vi.mock("@/server/auth/supabase", () => ({ createSupabaseServerClient: vi.fn(async () => sb) }));
vi.mock("@/server/auth/sync-user", () => sync);
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ APP_URL: "http://localhost:3000", ADMIN_EMAILS: ["boss@example.com"] }),
}));

import { GET as confirm } from "@/app/auth/confirm/route";
import { GET as callback } from "@/app/auth/callback/route";
import { GET as legacyLogin } from "@/app/login/route";

const USER = { id: "u1", email: "guest@example.com", user_metadata: { full_name: "Gina" } };

function req(pathAndQuery: string) {
  return new NextRequest(new URL(pathAndQuery, "http://localhost:3000"));
}

function location(res: Response): string {
  const url = new URL(res.headers.get("location")!, "http://localhost:3000");
  expect(url.origin).toBe("http://localhost:3000");
  return url.pathname + url.search;
}

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  sb.auth.verifyOtp.mockResolvedValue({ data: { user: USER }, error: null });
  sb.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });
  sync.syncUser.mockResolvedValue({ id: "u1" });
});

test("confirm: verifyOtp ok → syncUser → redirect to safe next", async () => {
  const res = await confirm(req("/auth/confirm?token_hash=abc&type=email&next=/ko/bookings?x=1"));
  expect(sb.auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
  expect(sync.syncUser).toHaveBeenCalledWith(
    {},
    { authId: "u1", email: "guest@example.com", name: "Gina", adminEmails: ["boss@example.com"] },
  );
  expect(sb.auth.signOut).not.toHaveBeenCalled();
  expect(res.status).toBe(307);
  expect(location(res)).toBe("/ko/bookings?x=1");
});

test("confirm: an absolute same-origin next (the template's RedirectTo) becomes its path", async () => {
  const next = encodeURIComponent("http://localhost:3000/en/bookings?a=1&b=2");
  const res = await confirm(req(`/auth/confirm?token_hash=abc&type=email&next=${next}`));
  expect(location(res)).toBe("/en/bookings?a=1&b=2");
});

test("confirm: verifyOtp error → signOut, redirect /en/login?error=auth", async () => {
  sb.auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
  const res = await confirm(req("/auth/confirm?token_hash=abc&type=email"));
  expect(sb.auth.signOut).toHaveBeenCalledOnce();
  expect(sync.syncUser).not.toHaveBeenCalled();
  expect(location(res)).toBe("/en/login?error=auth");
});

test("confirm: missing token_hash or unknown type → signOut, error redirect without verifying", async () => {
  for (const q of ["type=email", "token_hash=abc&type=bogus"]) {
    const res = await confirm(req(`/auth/confirm?${q}`));
    expect(location(res)).toBe("/en/login?error=auth");
  }
  expect(sb.auth.verifyOtp).not.toHaveBeenCalled();
  expect(sb.auth.signOut).toHaveBeenCalledTimes(2);
});

test("confirm: syncUser throws → signOut, redirect /ko/login?error=auth when next=/ko/...", async () => {
  sync.syncUser.mockRejectedValue(new Error("db down"));
  const res = await confirm(req("/auth/confirm?token_hash=abc&type=email&next=/ko/bookings"));
  expect(consoleError).toHaveBeenCalledOnce();
  expect(sb.auth.signOut).toHaveBeenCalledOnce();
  expect(location(res)).toBe("/ko/login?error=auth&next=%2Fko%2Fbookings");
});

test("confirm: next=//evil.com → redirect to /", async () => {
  for (const next of ["//evil.com", "https://evil.com/en", encodeURIComponent("http://localhost:3000.evil.com/x")]) {
    const res = await confirm(req(`/auth/confirm?token_hash=abc&type=email&next=${next}`));
    expect(location(res)).toBe("/");
  }
});

test("callback: code exchange ok → syncUser → redirect to next", async () => {
  const res = await callback(req("/auth/callback?code=c1&next=/en/bookings"));
  expect(sb.auth.exchangeCodeForSession).toHaveBeenCalledWith("c1");
  expect(sync.syncUser).toHaveBeenCalledOnce();
  expect(location(res)).toBe("/en/bookings");
});

test("callback: toAuthUser null → signOut and error redirect", async () => {
  sb.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1", user_metadata: {} } }, error: null });
  const res = await callback(req("/auth/callback?code=c1&next=/ko"));
  expect(sync.syncUser).not.toHaveBeenCalled();
  expect(sb.auth.signOut).toHaveBeenCalledOnce();
  expect(location(res)).toBe("/ko/login?error=auth&next=%2Fko");
});

test("legacy /login redirects to /ko/login keeping a safe next", async () => {
  expect(location(legacyLogin(req("/login?next=/admin/bookings")))).toBe("/ko/login?next=%2Fadmin%2Fbookings");
  expect(location(legacyLogin(req("/login?next=//evil.com")))).toBe("/ko/login?next=%2F");
  expect(location(legacyLogin(req("/login")))).toBe("/ko/login");
});

test("callback: syncUser throws → signOut and error redirect", async () => {
  sync.syncUser.mockRejectedValue(new Error("db down"));
  const res = await callback(req("/auth/callback?code=c1"));
  expect(consoleError).toHaveBeenCalledOnce();
  expect(sb.auth.signOut).toHaveBeenCalledOnce();
  expect(location(res)).toBe("/en/login?error=auth");
});
