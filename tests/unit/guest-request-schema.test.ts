import { describe, expect, test } from "vitest";
import en from "../../messages/en.json";
import ko from "../../messages/ko.json";
import { BOOKING_ERROR_CODES } from "@/server/bookings/errors";
import { GUEST_ERROR_KEYS, guestErrorMessageKey, toGuestErrorKey } from "@/server/guest/errors";
import { BookingError } from "@/server/bookings/errors";
import { quoteInput, requestInput } from "@/server/guest/requests";

const ROOM = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

const valid = {
  roomId: ROOM,
  moveIn: "2027-03-15",
  lastNight: "2027-05-14",
  occupants: "1",
  guestName: "  Gina Kim  ",
  nationality: "United States",
  gender: "female",
  contact: "WhatsApp +1 555 0100",
  message: "",
};

describe("requestInput", () => {
  test("accepts a single-occupant request, trims text, coerces occupants", () => {
    const r = requestInput.parse(valid);
    expect(r).toEqual({
      roomId: ROOM,
      moveIn: "2027-03-15",
      lastNight: "2027-05-14",
      occupants: 1,
      guestName: "Gina Kim",
      nationality: "United States",
      gender: "female",
      contact: "WhatsApp +1 555 0100",
      message: "",
    });
  });

  test("occupants 2 requires co-occupant name and gender", () => {
    const r = requestInput.safeParse({ ...valid, occupants: "2" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["coOccupantName", "coOccupantGender"]));

    const blank = requestInput.safeParse({ ...valid, occupants: 2, coOccupantName: "   ", coOccupantGender: "male" });
    expect(blank.success).toBe(false);

    const ok = requestInput.parse({ ...valid, occupants: 2, coOccupantName: " Mina ", coOccupantGender: "female" });
    expect(ok).toMatchObject({ occupants: 2, coOccupantName: "Mina", coOccupantGender: "female" });
  });

  test("occupants 1 ignores co-occupant fields", () => {
    const r = requestInput.parse({ ...valid, coOccupantName: "x".repeat(500), coOccupantGender: "other" });
    expect(r).not.toHaveProperty("coOccupantName");
    expect(r).not.toHaveProperty("coOccupantGender");
  });

  test.each([
    ["roomId", "not-a-uuid"],
    ["moveIn", "2027-02-30"],
    ["lastNight", "15/05/2027"],
    ["occupants", "3"],
    ["guestName", ""],
    ["guestName", "x".repeat(101)],
    ["nationality", "U"],
    ["nationality", "x".repeat(57)],
    ["gender", "other"],
    ["contact", "12"],
    ["contact", "x".repeat(101)],
    ["message", "x".repeat(1001)],
  ])("rejects %s=%j", (field, value) => {
    const r = requestInput.safeParse({ ...valid, [field]: value });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toContain(field);
  });

  test("message is optional", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.message;
    expect(requestInput.parse(rest).message).toBe("");
  });
});

describe("quoteInput", () => {
  test("accepts numbers or strings for occupants", () => {
    expect(quoteInput.parse({ roomId: ROOM, moveIn: "2027-03-15", lastNight: "2027-05-14", occupants: 2 })).toEqual({
      roomId: ROOM,
      moveIn: "2027-03-15",
      lastNight: "2027-05-14",
      occupants: 2,
    });
  });

  test.each([
    { roomId: "x" },
    { moveIn: "2027-13-01" },
    { occupants: 0 },
  ])("rejects %j", (patch) => {
    const r = quoteInput.safeParse({ roomId: ROOM, moveIn: "2027-03-15", lastNight: "2027-05-14", occupants: 1, ...patch });
    expect(r.success).toBe(false);
  });
});

describe("guest error messages", () => {
  const lookup = (messages: unknown, key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);

  test("every BookingError code has en and ko error message", () => {
    for (const code of BOOKING_ERROR_CODES) {
      const key = guestErrorMessageKey(code);
      expect(typeof lookup(en, key), `en ${key}`).toBe("string");
      expect(typeof lookup(ko, key), `ko ${key}`).toBe("string");
    }
  });

  test("VALIDATION and NOT_FOUND have messages too", () => {
    for (const code of GUEST_ERROR_KEYS) {
      expect(lookup(en, guestErrorMessageKey(code))).toEqual(expect.any(String));
      expect(lookup(ko, guestErrorMessageKey(code))).toMatch(/[가-힣]/);
    }
    expect(GUEST_ERROR_KEYS).toEqual(expect.arrayContaining(["VALIDATION", "NOT_FOUND", ...BOOKING_ERROR_CODES]));
  });

  test("toGuestErrorKey maps BookingError codes and ignores anything else", () => {
    expect(toGuestErrorKey(new BookingError("ROOM_UNAVAILABLE"))).toBe("ROOM_UNAVAILABLE");
    expect(toGuestErrorKey(new BookingError("PRICING", "MIN_STAY"))).toBe("PRICING");
    expect(toGuestErrorKey(new Error("boom"))).toBeNull();
  });
});
