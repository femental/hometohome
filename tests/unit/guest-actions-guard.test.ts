import { beforeEach, describe, expect, test, vi } from "vitest";

// Every guest action except the public price preview must call requireUser() before it touches the
// DB, services, email or navigation. Each guest actions file is enumerated so a new export is covered.

const guard = vi.hoisted(() => ({ signedIn: false }));

vi.mock("@/server/auth/guest", () => ({
  requireUser: vi.fn(async (next?: string) => {
    if (guard.signedIn) return { id: "u1", email: "gina@example.com", role: "guest", name: "Gina", locale: "en" };
    throw new Error(`NEXT_REDIRECT:/en/login?next=${encodeURIComponent(next ?? "")}`);
  }),
}));

// Any property access on the DB client fails the test loudly.
vi.mock("@/server/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`prisma.${String(prop)} accessed before requireUser`);
      },
    },
  ),
}));

vi.mock("@/server/guest/requests", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/guest/requests")>();
  return { ...real, submitRequest: vi.fn(), quoteRoom: vi.fn(async () => ({ ok: false, error: "NOT_FOUND" })) };
});
vi.mock("@/server/guest/bookings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/guest/bookings")>();
  return { ...real, guestWithdraw: vi.fn(), guestCancel: vi.fn() };
});
vi.mock("@/server/email/sender", () => ({ defaultEmailSender: vi.fn(() => ({ send: vi.fn() })) }));
vi.mock("@/server/env", () => ({
  serverEnv: vi.fn(() => ({ APP_URL: "http://localhost:3000", ADMIN_EMAILS: ["admin@example.com"] })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guest";
import { BookingError } from "@/server/bookings/errors";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { guestCancel, guestWithdraw } from "@/server/guest/bookings";
import { GuestError } from "@/server/guest/errors";
import { quoteRoom, submitRequest } from "@/server/guest/requests";
import * as roomActions from "@/app/[locale]/rooms/[id]/actions";
import * as accountActions from "@/app/[locale]/account/actions";
import * as bookingActions from "@/app/[locale]/bookings/actions";

const ROOM = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";
const BOOKING = "0b5d2c3e-8a4f-4f6b-9c1d-7e2a1b3c4d5e";

function requestForm(fields: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    locale: "ko",
    roomId: ROOM,
    moveIn: "2027-03-15",
    lastNight: "2027-05-14",
    occupants: "1",
    guestName: "Gina",
    nationality: "United States",
    gender: "female",
    contact: "+1 555 0100",
    message: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v);
  return fd;
}

type AnyAction = (...a: unknown[]) => Promise<unknown>;

const FILES = {
  "rooms/[id]/actions": { mod: roomActions, exports: ["quoteAction", "submitRequestAction"] },
  "account/actions": { mod: accountActions, exports: ["updateLocaleAction"] },
  "bookings/actions": { mod: bookingActions, exports: ["cancelAction", "withdrawAction"] },
};

/** Public by design: a price preview needs no account. Validated and published-only instead. */
const PUBLIC = new Set(["quoteAction"]);

const ARGS: Record<string, unknown[]> = {
  submitRequestAction: [requestForm()],
  updateLocaleAction: ["ko"],
  withdrawAction: [BOOKING, "ko"],
  cancelAction: [BOOKING, "full", "ko"],
};

const sideEffects = [
  submitRequest,
  quoteRoom,
  guestWithdraw,
  guestCancel,
  defaultEmailSender,
  serverEnv,
  redirect,
  revalidatePath,
];

beforeEach(() => {
  vi.clearAllMocks();
  guard.signedIn = false;
});

describe.each(Object.entries(FILES))("%s", (_file, { mod, exports }) => {
  test("exports exactly the planned actions", () => {
    // Every export of a "use server" file is a public endpoint.
    expect(Object.keys(mod).sort()).toEqual([...exports].sort());
    for (const [name, fn] of Object.entries(mod)) expect(typeof fn, name).toBe("function");
  });

  const guarded = Object.entries(mod as unknown as Record<string, AnyAction>).filter(([n]) => !PUBLIC.has(n));
  test.each(guarded)("%s redirects an anonymous caller before touching data", async (name, action) => {
    await expect(action(...ARGS[name])).rejects.toThrow("NEXT_REDIRECT");
    expect(requireUser).toHaveBeenCalledOnce();
    for (const m of sideEffects) expect(m).not.toHaveBeenCalled();
  });
});

describe("submitRequestAction", () => {
  test("an anonymous caller is sent to login with the room page as next", async () => {
    await expect(roomActions.submitRequestAction(requestForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(requireUser).toHaveBeenCalledWith(`/ko/rooms/${ROOM}`);
  });

  test("a tampered locale or room id never reaches the login next", async () => {
    await expect(
      roomActions.submitRequestAction(requestForm({ locale: "//evil.example", roomId: "../admin" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(requireUser).toHaveBeenCalledWith("/en");
  });

  describe("signed in", () => {
    beforeEach(() => {
      guard.signedIn = true;
    });

    test("invalid input returns VALIDATION with the failing fields and calls no service", async () => {
      const r = await roomActions.submitRequestAction(requestForm({ guestName: "", occupants: "2" }));
      expect(r).toEqual({
        ok: false,
        error: "VALIDATION",
        fields: expect.arrayContaining(["guestName"]),
      });
      expect(submitRequest).not.toHaveBeenCalled();
    });

    test("a BookingError is returned as its code", async () => {
      vi.mocked(submitRequest).mockRejectedValueOnce(new BookingError("ROOM_UNAVAILABLE"));
      const r = await roomActions.submitRequestAction(requestForm());
      expect(r).toEqual({ ok: false, error: "ROOM_UNAVAILABLE" });
      expect(redirect).not.toHaveBeenCalled();
    });

    test("an unexpected error is rethrown", async () => {
      vi.mocked(submitRequest).mockRejectedValueOnce(new Error("db down"));
      await expect(roomActions.submitRequestAction(requestForm())).rejects.toThrow("db down");
    });

    test("success redirects to the booking page in the page locale", async () => {
      vi.mocked(submitRequest).mockResolvedValueOnce({ bookingId: "b-1" });
      await expect(roomActions.submitRequestAction(requestForm())).rejects.toThrow("NEXT_REDIRECT:/ko/bookings/b-1");
      expect(submitRequest).toHaveBeenCalledWith(
        expect.objectContaining({ appUrl: "http://localhost:3000", adminEmails: ["admin@example.com"] }),
        { id: "u1", email: "gina@example.com", locale: "en" },
        expect.objectContaining({ roomId: ROOM, occupants: 1, guestName: "Gina" }),
      );
    });
  });
});

describe("quoteAction (public)", () => {
  test.each([
    {},
    { roomId: ROOM },
    { roomId: "x", moveIn: "2027-03-15", lastNight: "2027-05-14", occupants: 1 },
    { roomId: ROOM, moveIn: "2027-03-15", lastNight: "2027-05-14", occupants: 3 },
  ])("rejects malformed input %j without a lookup", async (input) => {
    const r = await roomActions.quoteAction(input as never);
    expect(r).toEqual({ ok: false, error: "VALIDATION" });
    expect(quoteRoom).not.toHaveBeenCalled();
  });

  test("valid input is quoted by the service (which only knows published rooms)", async () => {
    const r = await roomActions.quoteAction({ roomId: ROOM, moveIn: "2027-03-15", lastNight: "2027-05-14", occupants: 1 });
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(quoteRoom).toHaveBeenCalledOnce();
  });
});

describe.each([
  ["withdrawAction", (id: string, locale: string) => bookingActions.withdrawAction(id, locale), guestWithdraw],
  ["cancelAction", (id: string, locale: string) => bookingActions.cancelAction(id, "full", locale), guestCancel],
] as const)("%s", (_name, action, service) => {
  test("an anonymous caller is sent to login with the booking page as next", async () => {
    await expect(action(BOOKING, "ko")).rejects.toThrow("NEXT_REDIRECT");
    expect(requireUser).toHaveBeenCalledWith(`/ko/bookings/${BOOKING}`);
  });

  test("a tampered id or locale never reaches the login next", async () => {
    await expect(action("../admin", "//evil.example")).rejects.toThrow("NEXT_REDIRECT");
    expect(requireUser).toHaveBeenCalledWith("/en/bookings");
  });

  describe("signed in", () => {
    beforeEach(() => {
      guard.signedIn = true;
    });

    test("a malformed id is NOT_FOUND without a lookup", async () => {
      expect(await action("not-a-uuid", "en")).toEqual({ ok: false, error: "NOT_FOUND" });
      expect(service).not.toHaveBeenCalled();
    });

    test("someone else's booking (FORBIDDEN) is reported as NOT_FOUND", async () => {
      vi.mocked(service).mockRejectedValueOnce(new BookingError("FORBIDDEN"));
      expect(await action(BOOKING, "en")).toEqual({ ok: false, error: "NOT_FOUND" });
      expect(vi.mocked(service).mock.calls[0][1]).toBe("u1");
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("a state refusal is returned as its code and the pages are revalidated", async () => {
      vi.mocked(service).mockRejectedValueOnce(new BookingError("INVALID_STATE"));
      expect(await action(BOOKING, "en")).toEqual({ ok: false, error: "INVALID_STATE" });
      expect(revalidatePath).toHaveBeenCalled();
    });

    test("an unexpected error is rethrown", async () => {
      vi.mocked(service).mockRejectedValueOnce(new Error("db down"));
      await expect(action(BOOKING, "en")).rejects.toThrow("db down");
    });
  });
});

describe("booking actions succeed for the caller's own booking", () => {
  beforeEach(() => {
    guard.signedIn = true;
  });

  test("withdrawAction acts as the signed-in guest and revalidates", async () => {
    expect(await bookingActions.withdrawAction(BOOKING, "en")).toEqual({ ok: true });
    expect(guestWithdraw).toHaveBeenCalledWith(expect.objectContaining({ now: expect.any(Date) }), "u1", BOOKING);
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/bookings/[id]", "page");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("cancelAction returns the server-computed refund", async () => {
    vi.mocked(guestCancel).mockResolvedValueOnce({ refundKrw: 1_300_000, refundIds: [] });
    expect(await bookingActions.cancelAction(BOOKING, "deposit_only", "en")).toEqual({ ok: true, refundKrw: 1_300_000 });
    expect(guestCancel).toHaveBeenCalledWith(
      expect.objectContaining({ appUrl: "http://localhost:3000", adminEmails: ["admin@example.com"] }),
      "u1",
      BOOKING,
      "deposit_only",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/bookings", "page");
  });
});

describe("cancelAction expected refund kind", () => {
  beforeEach(() => {
    guard.signedIn = true;
  });

  test.each(["not_allowed", "", undefined, "FULL"])("rejects expected kind %j as VALIDATION without a call", async (kind) => {
    expect(await bookingActions.cancelAction(BOOKING, kind as never, "en")).toEqual({ ok: false, error: "VALIDATION" });
    expect(guestCancel).not.toHaveBeenCalled();
  });

  test("a changed refund comes back as REFUND_CHANGED and the page is revalidated with the new preview", async () => {
    vi.mocked(guestCancel).mockRejectedValueOnce(new GuestError("REFUND_CHANGED"));
    expect(await bookingActions.cancelAction(BOOKING, "full", "en")).toEqual({ ok: false, error: "REFUND_CHANGED" });
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/bookings/[id]", "page");
  });
});
