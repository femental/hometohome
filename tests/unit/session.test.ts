import { afterEach, beforeEach, expect, test, vi } from "vitest";

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  forbidden: vi.fn(() => {
    throw new Error("NEXT_FORBIDDEN");
  }),
}));
vi.mock("next/navigation", () => nav);
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ ADMIN_EMAILS: ["boss@example.com"] }) }));
vi.mock("@/server/auth/sync-user", () => ({
  syncUser: vi.fn(async (_db: unknown, a: { authId: string; email: string; adminEmails: string[] }) => ({
    id: a.authId,
    email: a.email,
    name: "x",
    locale: "en",
    role: a.adminEmails.includes(a.email.toLowerCase()) ? "admin" : "guest",
  })),
}));

import { __setAuthResolverForTests, requireAdmin, requireUser, safeNext } from "@/server/auth/session";

beforeEach(() => vi.clearAllMocks());
afterEach(() => __setAuthResolverForTests(null));

test("requireAdmin redirects anonymous to /login", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenCalledWith("/login");
  expect(nav.forbidden).not.toHaveBeenCalled();
});

test("requireAdmin keeps a safe next path in the login redirect", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(requireAdmin("/admin/bookings?status=requested")).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fbookings%3Fstatus%3Drequested");
});

test("requireAdmin rejects guest with forbidden/notFound", async () => {
  __setAuthResolverForTests(async () => ({ id: "g1", email: "guest@example.com" }));
  await expect(requireAdmin()).rejects.toThrow("NEXT_FORBIDDEN");
  expect(nav.forbidden).toHaveBeenCalledOnce();
  expect(nav.redirect).not.toHaveBeenCalled();
});

test("requireAdmin returns admin SessionUser", async () => {
  __setAuthResolverForTests(async () => ({ id: "a1", email: "Boss@Example.com" }));
  await expect(requireAdmin()).resolves.toEqual({ id: "a1", email: "Boss@Example.com", role: "admin" });
});

test("requireUser redirects anonymous and returns signed-in guest", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(requireUser("/bookings")).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenCalledWith("/login?next=%2Fbookings");

  __setAuthResolverForTests(async () => ({ id: "g1", email: "guest@example.com" }));
  await expect(requireUser()).resolves.toEqual({ id: "g1", email: "guest@example.com", role: "guest" });
});

test("callback next param: only same-origin relative paths allowed", () => {
  expect(safeNext("/admin")).toBe("/admin");
  expect(safeNext("/admin/rooms?x=1#top")).toBe("/admin/rooms?x=1#top");
  expect(safeNext("https://evil.com")).toBe("/");
  expect(safeNext("//evil.com")).toBe("/");
  expect(safeNext("/\\evil.com")).toBe("/");
  expect(safeNext("/\t/evil.com")).toBe("/");
  expect(safeNext("admin")).toBe("/");
  expect(safeNext("")).toBe("/");
  expect(safeNext(null)).toBe("/");
});
