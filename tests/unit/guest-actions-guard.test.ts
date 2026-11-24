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

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guest";
import { BookingError } from "@/server/bookings/errors";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { quoteRoom, submitRequest } from "@/server/guest/requests";
import * as roomActions from "@/app/[locale]/rooms/[id]/actions";
import * as accountActions from "@/app/[locale]/account/actions";

const ROOM = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

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
};

/** Public by design: a price preview needs no account. Validated and published-only instead. */
const PUBLIC = new Set(["quoteAction"]);

const ARGS: Record<string, unknown[]> = {
  submitRequestAction: [requestForm()],
  updateLocaleAction: ["ko"],
};

const sideEffects = [submitRequest, quoteRoom, defaultEmailSender, serverEnv, redirect];

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
