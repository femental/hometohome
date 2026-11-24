import { beforeEach, describe, expect, test, vi } from "vitest";

// Every booking action must call requireAdmin() before it touches the DB, services, email or caches.

const guard = vi.hoisted(() => ({ mode: "forbidden" as "forbidden" | "anonymous" | "admin" }));

vi.mock("@/server/auth/session", () => ({
  requireAdmin: vi.fn(async () => {
    if (guard.mode === "admin") return { id: "admin", email: "admin@example.com", role: "admin" };
    throw new Error(guard.mode === "forbidden" ? "NEXT_FORBIDDEN" : "NEXT_REDIRECT:/login");
  }),
}));

// Any property access on the DB client fails the test loudly.
vi.mock("@/server/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`prisma.${String(prop)} accessed before requireAdmin`);
      },
    },
  ),
}));

vi.mock("@/server/admin/bookings", () => ({
  adminApprove: vi.fn(),
  adminReject: vi.fn(),
  adminConfirmOffline: vi.fn(),
  previewCancellation: vi.fn(),
  adminCancel: vi.fn(),
  adminMarkRefundDone: vi.fn(),
  adminComplete: vi.fn(),
  adminDepositReturned: vi.fn(),
  listRequests: vi.fn(),
  listBookings: vi.fn(),
  getBookingDetail: vi.fn(),
  dashboardCounts: vi.fn(),
}));

vi.mock("@/server/admin/catalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/admin/catalog")>();
  return { CatalogError: real.CatalogError };
});
vi.mock("@/server/photos/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/photos/service")>();
  return { PhotoError: real.PhotoError };
});
vi.mock("@/server/email/sender", () => ({ defaultEmailSender: vi.fn() }));
vi.mock("@/server/env", () => ({
  serverEnv: vi.fn(() => ({ APP_URL: "http://localhost:3000", ADMIN_EMAILS: ["admin@example.com"] })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), forbidden: vi.fn(), notFound: vi.fn() }));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as bookings from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/session";
import { BOOKING_ERROR_CODES, BookingError } from "@/server/bookings/errors";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import * as bookingActions from "@/app/admin/actions/bookings";
import { BOOKING_ERROR_MESSAGES, knownErrorMessage } from "@/app/admin/actions/messages";

const ID = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

function formData(fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("reason", "방 수리 일정");
  fd.set("method", "bank_transfer");
  fd.set("amountKrw", "1300000");
  fd.set("note", "메모");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// Plausible arguments for any of the signatures (bound id, prevState, FormData).
const ARGS = [ID, null, formData()];

const all = bookingActions as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

const sideEffects = [
  ...Object.values(bookings).filter((v) => vi.isMockFunction(v)),
  defaultEmailSender,
  serverEnv,
  revalidatePath,
  redirect,
];

beforeEach(() => {
  vi.clearAllMocks();
  guard.mode = "forbidden";
});

test("the actions file exports exactly the planned actions", () => {
  // Every export of a "use server" file is a public endpoint.
  expect(Object.keys(bookingActions).sort()).toEqual([
    "approveAction",
    "cancelAction",
    "completeAction",
    "confirmOfflineAction",
    "depositReturnedAction",
    "markRefundDoneAction",
    "rejectAction",
    "retryRefundAction",
  ]);
  for (const [name, fn] of Object.entries(all)) expect(typeof fn, name).toBe("function");
});

describe.each(["forbidden", "anonymous"] as const)("%s caller", (mode) => {
  test.each(Object.entries(all))("%s refuses before touching data", async (_name, action) => {
    guard.mode = mode;
    await expect(action(...ARGS)).rejects.toThrow(mode === "forbidden" ? "NEXT_FORBIDDEN" : "NEXT_REDIRECT");
    expect(requireAdmin).toHaveBeenCalledOnce();
    for (const m of sideEffects) expect(m).not.toHaveBeenCalled();
  });
});

describe("input validation (admin caller)", () => {
  beforeEach(() => {
    guard.mode = "admin";
  });

  test.each(["", "   "])("rejectAction refuses an empty reason %j", async (reason) => {
    const r = await bookingActions.rejectAction(ID, null, formData({ reason }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(bookings.adminReject).not.toHaveBeenCalled();
  });

  test("rejectAction refuses a reason over 500 characters", async () => {
    const r = await bookingActions.rejectAction(ID, null, formData({ reason: "가".repeat(501) }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(bookings.adminReject).not.toHaveBeenCalled();
  });

  test.each([
    { field: "method", value: "paypal" },
    { field: "amountKrw", value: "0" },
    { field: "amountKrw", value: "12.5" },
    { field: "amountKrw", value: "" },
    { field: "note", value: "x".repeat(501) },
  ])("confirmOfflineAction refuses $field=$value", async ({ field, value }) => {
    const r = await bookingActions.confirmOfflineAction(ID, null, formData({ [field]: value }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
    expect(bookings.adminConfirmOffline).not.toHaveBeenCalled();
  });

  test.each(Object.entries(all))("%s refuses a malformed id", async (_name, action) => {
    const r = await action("not-a-uuid", null, formData());
    expect(r).toMatchObject({ ok: false, error: expect.any(String) });
    for (const m of sideEffects) expect(m).not.toHaveBeenCalled();
  });
});

describe("booking error messages", () => {
  test.each(BOOKING_ERROR_CODES)("%s has a Korean message", (code) => {
    expect(BOOKING_ERROR_MESSAGES[code]).toMatch(/[가-힣]/);
    expect(knownErrorMessage(new BookingError(code))).toBe(BOOKING_ERROR_MESSAGES[code]);
  });

  test("the planned wording", () => {
    expect(BOOKING_ERROR_MESSAGES.ROOM_UNAVAILABLE).toBe("같은 기간에 이미 점유된 예약이 있습니다");
    expect(BOOKING_ERROR_MESSAGES.INVALID_STATE).toBe("현재 상태에서는 할 수 없는 작업입니다");
    expect(BOOKING_ERROR_MESSAGES.CANCEL_NOT_ALLOWED).toBe("입주일 이후에는 온라인 취소가 불가합니다");
  });

  test("a missing booking reads as not found, not as a state problem", () => {
    expect(knownErrorMessage(new BookingError("NOT_FOUND"))).toBe("예약을 찾을 수 없습니다");
  });

  test("an amount mismatch has its own wording, keyed by code", () => {
    expect(knownErrorMessage(new BookingError("AMOUNT_MISMATCH"))).toBe("받은 금액이 첫 결제 금액과 다릅니다");
    expect(BOOKING_ERROR_MESSAGES.REFUND_CHANGED).toMatch(/환불/);
  });
});
