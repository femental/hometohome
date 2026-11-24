import { expect, test, vi } from "vitest";

// Once a cancellation has committed, a failure while executing its PG refund must not turn the
// action into an error: the refund row stays pending/processing for the operator's retry button.

vi.mock("@/server/auth/guest", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "g@example.com", role: "guest", name: "G", locale: "en" })),
}));
vi.mock("@/server/auth/session", () => ({ requireAdmin: vi.fn(async () => ({ id: "a1", email: "admin@example.com", role: "admin" })) }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/email/sender", () => ({ defaultEmailSender: vi.fn(() => ({ send: vi.fn() })) }));
vi.mock("@/server/env", () => ({
  serverEnv: vi.fn(() => ({ APP_URL: "http://localhost:3000", ADMIN_EMAILS: ["admin@example.com"] })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/guest/bookings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/guest/bookings")>();
  return { ...real, guestCancel: vi.fn(async () => ({ refundKrw: 1_300_000, refundIds: ["r1"] })) };
});
vi.mock("@/server/admin/bookings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/admin/bookings")>();
  return { ...real, adminCancel: vi.fn(async () => ({ refundIds: ["r1"] })) };
});
vi.mock("@/server/payments/deps", () => ({ payDeps: vi.fn(() => ({ fake: "deps" })) }));
vi.mock("@/server/payments/refunds", () => ({
  runRefunds: vi.fn(async () => {
    throw new Error("transaction timeout");
  }),
}));

import * as guestActions from "@/app/[locale]/bookings/actions";
import * as adminActions from "@/app/admin/actions/bookings";
import { runRefunds } from "@/server/payments/refunds";

const BOOKING = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

test("guest cancel still succeeds when running its PG refund throws", async () => {
  expect(await guestActions.cancelAction(BOOKING, "full", "en")).toEqual({ ok: true, refundKrw: 1_300_000 });
  expect(runRefunds).toHaveBeenCalled();
});

test("operator cancel still succeeds when running its PG refund throws", async () => {
  expect(await adminActions.cancelAction(BOOKING)).toEqual({ ok: true });
});
