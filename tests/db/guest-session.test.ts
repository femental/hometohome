import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";

const env = vi.hoisted(() => ({ ADMIN_EMAILS: ["boss@example.com"] }));
vi.mock("@/server/env", () => ({ serverEnv: () => env }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  forbidden: vi.fn(),
}));

import { prisma } from "@/server/db";
import { __setAuthResolverForTests } from "@/server/auth/session";
import { getGuestUser } from "@/server/auth/guest";
import { updateLocaleAction } from "@/app/[locale]/account/actions";
import { resetDb } from "./factories";

beforeEach(async () => {
  await resetDb();
  env.ADMIN_EMAILS = ["boss@example.com"];
});
afterEach(() => __setAuthResolverForTests(null));
afterAll(() => prisma.$disconnect());

test("getGuestUser reads existing row without writing", async () => {
  await prisma.user.create({
    data: { id: "a1", email: "boss@example.com", name: "Boss", role: "admin", locale: "ko" },
  });
  const before = await prisma.$queryRaw<{ xmin: string }[]>`SELECT xmin::text FROM users WHERE id = 'a1'`;

  // Even with the email removed from ADMIN_EMAILS and a new profile name, nothing is re-synced.
  env.ADMIN_EMAILS = [];
  __setAuthResolverForTests(async () => ({ id: "a1", email: "boss@example.com", name: "New Name" }));

  await expect(getGuestUser()).resolves.toEqual({
    id: "a1",
    email: "boss@example.com",
    role: "admin",
    name: "Boss",
    locale: "ko",
  });
  const after = await prisma.$queryRaw<{ xmin: string }[]>`SELECT xmin::text FROM users WHERE id = 'a1'`;
  expect(after[0].xmin).toBe(before[0].xmin); // the row was not rewritten
  expect(await prisma.user.findUniqueOrThrow({ where: { id: "a1" } })).toMatchObject({ role: "admin", name: "Boss" });
});

test("getGuestUser creates row once when missing", async () => {
  __setAuthResolverForTests(async () => ({ id: "g1", email: "gina@example.com", name: "Gina" }));

  await expect(getGuestUser()).resolves.toEqual({
    id: "g1",
    email: "gina@example.com",
    role: "guest",
    name: "Gina",
    locale: "en",
  });
  expect(await prisma.user.count()).toBe(1);

  await getGuestUser();
  expect(await prisma.user.count()).toBe(1);
});

test("getGuestUser returns null when signed out", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(getGuestUser()).resolves.toBeNull();
  expect(await prisma.user.count()).toBe(0);
});

test("updateLocaleAction stores locale", async () => {
  await prisma.user.create({ data: { id: "g1", email: "gina@example.com", name: "Gina" } });
  __setAuthResolverForTests(async () => ({ id: "g1", email: "gina@example.com" }));

  await updateLocaleAction("ko");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: "g1" } })).locale).toBe("ko");

  // Anything that is not a supported locale is rejected and leaves the row alone.
  await expect(updateLocaleAction("fr" as never)).rejects.toThrow();
  expect((await prisma.user.findUniqueOrThrow({ where: { id: "g1" } })).locale).toBe("ko");
});

test("updateLocaleAction redirects anonymous visitors to login", async () => {
  __setAuthResolverForTests(async () => null);
  await expect(updateLocaleAction("ko")).rejects.toThrow("NEXT_REDIRECT:/en/login");
});
