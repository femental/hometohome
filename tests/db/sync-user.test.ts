import { afterAll, beforeEach, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { syncUser } from "@/server/auth/sync-user";
import { resetDb } from "./factories";

const ADMINS = ["boss@example.com"];

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

test("new user in ADMIN_EMAILS becomes admin, others guest", async () => {
  const admin = await syncUser(prisma, { authId: "auth-admin", email: "boss@example.com", adminEmails: ADMINS });
  const guest = await syncUser(prisma, {
    authId: "auth-guest",
    email: "guest@example.com",
    name: "Gina",
    adminEmails: ADMINS,
  });

  expect(admin).toMatchObject({ id: "auth-admin", role: "admin", locale: "en", name: "boss" });
  expect(guest).toMatchObject({ id: "auth-guest", role: "guest", locale: "en", name: "Gina" });
});

test("email matching is case-insensitive", async () => {
  const user = await syncUser(prisma, { authId: "a1", email: "Boss@Example.com", adminEmails: ADMINS });
  expect(user.role).toBe("admin");
});

test("removed from ADMIN_EMAILS → demoted to guest on next sync", async () => {
  await syncUser(prisma, { authId: "a1", email: "boss@example.com", adminEmails: ADMINS });
  const again = await syncUser(prisma, { authId: "a1", email: "boss@example.com", adminEmails: [] });
  expect(again.role).toBe("guest");
  expect(await prisma.user.count()).toBe(1);
});

test("existing user's locale is not overwritten", async () => {
  await syncUser(prisma, { authId: "a1", email: "g@example.com", adminEmails: ADMINS });
  await prisma.user.update({ where: { id: "a1" }, data: { locale: "ko" } });
  const again = await syncUser(prisma, { authId: "a1", email: "g@example.com", adminEmails: ADMINS });
  expect(again.locale).toBe("ko");
});

test("existing name is kept when none is provided; stored email follows the auth user", async () => {
  await syncUser(prisma, { authId: "a1", email: "old@example.com", name: "Kim", adminEmails: ADMINS });
  const again = await syncUser(prisma, { authId: "a1", email: "new@example.com", name: "  ", adminEmails: ADMINS });
  expect(again).toMatchObject({ name: "Kim", email: "new@example.com" });
});
