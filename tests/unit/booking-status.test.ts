import { expect, test } from "vitest";
import {
  type BookingEvent,
  type BookingStatus,
  HOLD_TTL_MS,
  InvalidTransitionError,
  OCCUPYING_STATUSES,
  REQUEST_TTL_MS,
  effectiveStatus,
  nextStatus,
} from "@/domain/booking-status";

test.each<[BookingStatus, BookingEvent, BookingStatus]>([
  ["requested", "approve", "awaiting_payment"],
  ["requested", "reject", "rejected"],
  ["requested", "expire_request", "request_expired"],
  ["requested", "withdraw", "withdrawn"],
  ["awaiting_payment", "pay", "confirmed"],
  ["awaiting_payment", "expire_payment", "payment_expired"],
  ["awaiting_payment", "cancel", "cancelled"],
  ["confirmed", "cancel", "cancelled"],
  ["confirmed", "complete", "completed"],
])("%s --%s--> %s", (from, event, to) => {
  expect(nextStatus(from, event)).toBe(to);
});

test("invalid transitions throw", () => {
  expect(() => nextStatus("requested", "pay")).toThrow(InvalidTransitionError);
  expect(() => nextStatus("payment_expired", "pay")).toThrow(InvalidTransitionError);
  expect(() => nextStatus("cancelled", "cancel")).toThrow(InvalidTransitionError);
});

test("InvalidTransitionError exposes from and event", () => {
  let caught: unknown;
  try {
    nextStatus("completed", "cancel");
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(InvalidTransitionError);
  expect((caught as InvalidTransitionError).from).toBe("completed");
  expect((caught as InvalidTransitionError).event).toBe("cancel");
});

test("effectiveStatus applies expiry at read time", () => {
  const now = new Date("2027-03-01T00:00:00Z");
  expect(effectiveStatus({ status: "awaiting_payment", requestExpiresAt: null, holdExpiresAt: new Date("2027-02-28T23:59:59Z") }, now)).toBe("payment_expired");
  expect(effectiveStatus({ status: "requested", requestExpiresAt: new Date("2027-03-01T00:00:01Z"), holdExpiresAt: null }, now)).toBe("requested");
  expect(effectiveStatus({ status: "requested", requestExpiresAt: now, holdExpiresAt: null }, now)).toBe("request_expired");
});

test("effectiveStatus never expires on null expiry or other statuses", () => {
  const now = new Date("2027-03-01T00:00:00Z");
  const past = new Date("2020-01-01T00:00:00Z");
  expect(effectiveStatus({ status: "requested", requestExpiresAt: null, holdExpiresAt: past }, now)).toBe("requested");
  expect(effectiveStatus({ status: "awaiting_payment", requestExpiresAt: past, holdExpiresAt: null }, now)).toBe("awaiting_payment");
  expect(effectiveStatus({ status: "confirmed", requestExpiresAt: past, holdExpiresAt: past }, now)).toBe("confirmed");
});

test("constants", () => {
  expect(OCCUPYING_STATUSES).toEqual(["awaiting_payment", "confirmed"]);
  expect(REQUEST_TTL_MS).toBe(48 * 3600_000);
  expect(HOLD_TTL_MS).toBe(24 * 3600_000);
});
