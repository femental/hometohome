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
const db = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn(async () => null as unknown) } },
}));
vi.mock("@/server/db", () => db);
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

import { __setAuthResolverForTests, requireAdmin, safeNext } from "@/server/auth/session";
import { localeFromPath, requireUser } from "@/server/auth/guest";

beforeEach(() => vi.clearAllMocks());
afterEach(() => __setAuthResolverForTests(null));

test("requireAdmin redirects anonymous to /ko/login", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenCalledWith("/ko/login");
  expect(nav.forbidden).not.toHaveBeenCalled();
});

test("requireAdmin keeps a safe next path in the login redirect", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(requireAdmin("/admin/bookings?status=requested")).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenCalledWith("/ko/login?next=%2Fadmin%2Fbookings%3Fstatus%3Drequested");
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

test("requireUser redirects anonymous to the login page of next's locale", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(requireUser("/ko/bookings")).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenCalledWith("/ko/login?next=%2Fko%2Fbookings");

  await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
  expect(nav.redirect).toHaveBeenLastCalledWith("/en/login");
});

test("requireUser returns the stored guest without syncing", async () => {
  db.prisma.user.findUnique.mockResolvedValueOnce({
    id: "g1",
    email: "guest@example.com",
    name: "Gina",
    role: "guest",
    locale: "ko",
  });
  __setAuthResolverForTests(async () => ({ id: "g1", email: "guest@example.com" }));
  await expect(requireUser()).resolves.toEqual({
    id: "g1",
    email: "guest@example.com",
    role: "guest",
    name: "Gina",
    locale: "ko",
  });
  const { syncUser } = await import("@/server/auth/sync-user");
  expect(syncUser).not.toHaveBeenCalled();
});

test("localeFromPath: first segment if it is a locale, else en", () => {
  expect(localeFromPath("/ko")).toBe("ko");
  expect(localeFromPath("/ko/bookings?x=1")).toBe("ko");
  expect(localeFromPath("/en/rooms")).toBe("en");
  expect(localeFromPath("/kor/x")).toBe("en");
  expect(localeFromPath("/admin")).toBe("en");
  expect(localeFromPath("/")).toBe("en");
  expect(localeFromPath(undefined)).toBe("en");
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
