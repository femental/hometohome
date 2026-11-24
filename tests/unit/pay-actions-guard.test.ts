import { beforeEach, expect, test, vi } from "vitest";

// Pay actions must call requireUser() before touching the DB, the PG or the payment services.

const guard = vi.hoisted(() => ({ signedIn: false, ownCount: 0 }));

vi.mock("@/server/auth/guest", () => ({
  requireUser: vi.fn(async (next?: string) => {
    if (guard.signedIn) return { id: "u1", email: "g@example.com", role: "guest", name: "G", locale: "en" };
    throw new Error(`NEXT_REDIRECT:/en/login?next=${encodeURIComponent(next ?? "")}`);
  }),
}));
vi.mock("@/server/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        if (!guard.signedIn) throw new Error(`prisma.${String(prop)} accessed before requireUser`);
        return { count: vi.fn(async () => guard.ownCount) };
      },
    },
  ),
}));
vi.mock("@/server/payments/deps", () => ({ payDeps: vi.fn(() => ({ fake: "deps" })) }));
vi.mock("@/server/payments/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/payments/service")>();
  return { ...real, preparePayment: vi.fn(), completePayment: vi.fn(async () => ({ outcome: "confirmed" })) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import * as payActions from "@/app/[locale]/bookings/[id]/pay/actions";
import { completePayment, preparePayment } from "@/server/payments/service";
import { payDeps } from "@/server/payments/deps";

const BOOKING = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";
const PAYMENT = "0b7c6a1e-1d2e-4f3a-8b9c-0a1b2c3d4e5f";

beforeEach(() => {
  guard.signedIn = false;
  guard.ownCount = 0;
  vi.clearAllMocks();
});

test("exports exactly the pay actions", () => {
  expect(Object.keys(payActions).sort()).toEqual(["completePaymentAction", "fakeCheckoutAction", "preparePaymentAction"]);
});

test("fake checkout is refused outside fake mode", async () => {
  guard.signedIn = true;
  expect(await payActions.fakeCheckoutAction(PAYMENT, "en")).toEqual({ ok: false, error: "NOT_FOUND" });
  expect(completePayment).not.toHaveBeenCalled();
});

test("anonymous callers are redirected before any service, PG or DB use", async () => {
  await expect(payActions.preparePaymentAction(BOOKING, "card", "en")).rejects.toThrow(/NEXT_REDIRECT/);
  await expect(payActions.completePaymentAction(PAYMENT, "en")).rejects.toThrow(/NEXT_REDIRECT/);
  await expect(payActions.fakeCheckoutAction(PAYMENT, "en")).rejects.toThrow(/NEXT_REDIRECT/);
  expect(payDeps).not.toHaveBeenCalled();
  expect(preparePayment).not.toHaveBeenCalled();
  expect(completePayment).not.toHaveBeenCalled();
});

test("invalid method or id → VALIDATION without calling the service", async () => {
  guard.signedIn = true;
  expect(await payActions.preparePaymentAction(BOOKING, "crypto", "en")).toEqual({ ok: false, error: "VALIDATION" });
  expect(await payActions.preparePaymentAction("nope", "card", "en")).toEqual({ ok: false, error: "VALIDATION" });
  expect(preparePayment).not.toHaveBeenCalled();
});

test("completePaymentAction refuses a payment that is not on the caller's own booking", async () => {
  guard.signedIn = true;
  guard.ownCount = 0;
  expect(await payActions.completePaymentAction(PAYMENT, "en")).toEqual({ ok: false, error: "NOT_FOUND" });
  expect(completePayment).not.toHaveBeenCalled();
  guard.ownCount = 1;
  expect(await payActions.completePaymentAction(PAYMENT, "en")).toEqual({ ok: true, outcome: "confirmed" });
});
