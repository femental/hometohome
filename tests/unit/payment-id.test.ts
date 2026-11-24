import { expect, test } from "vitest";
import { paymentIdFromQuery } from "@/lib/payment-id";

const ID = "af9bf108-9587-442a-bd5f-3df3492dd261";

test("a single uuid is used as is", () => {
  expect(paymentIdFromQuery(ID)).toBe(ID);
});

test("the same id twice (our redirectUrl + PortOne's appended paymentId) is accepted", () => {
  expect(paymentIdFromQuery([ID, ID])).toBe(ID);
});

test("different ids, malformed ids or nothing → null", () => {
  expect(paymentIdFromQuery([ID, "0b7c6a1e-1d2e-4f3a-8b9c-0a1b2c3d4e5f"])).toBeNull();
  expect(paymentIdFromQuery("nope")).toBeNull();
  expect(paymentIdFromQuery(undefined)).toBeNull();
  expect(paymentIdFromQuery([])).toBeNull();
});
