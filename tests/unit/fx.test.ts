import { test, expect } from "vitest";
import { DEFAULT_FX_MARGIN, quoteForeignMinor, proportionalRefundMinor } from "@/domain/fx";

test("default margin is 2%", () => {
  expect(DEFAULT_FX_MARGIN).toBe(0.02);
});

test("quote: KRW→USD cents with 2% margin, rounded up", () => {
  // 1,300,000 / 1,380 = 942.0289… × 1.02 = 960.8695… → 96087 cents
  expect(quoteForeignMinor(1_300_000, 1380)).toBe(96087);
  expect(quoteForeignMinor(1_300_000, 1380, 0)).toBe(94203);
});

test("quote: fractional rate uses exact arithmetic", () => {
  // 1,300,000 × 1.02 × 100 / 1380.55 = 96048.0007… → ceil 96049
  expect(quoteForeignMinor(1_300_000, 1380.55)).toBe(96049);
});

test("quote: exact division is not bumped up", () => {
  // 1,000,000 × 100 / 1000 = 100000 exactly
  expect(quoteForeignMinor(1_000_000, 1000, 0)).toBe(100000);
});

test("quote: rejects invalid input", () => {
  expect(() => quoteForeignMinor(1000, 0)).toThrow();
  expect(() => quoteForeignMinor(-1, 1380)).toThrow();
  expect(() => quoteForeignMinor(1000, 1380, -0.1)).toThrow();
});

test("proportional refund", () => {
  expect(proportionalRefundMinor(96087, 1_300_000, 500_000)).toBe(36957); // 36956.54 → round
  expect(proportionalRefundMinor(96087, 1_300_000, 1_300_000)).toBe(96087);
  expect(proportionalRefundMinor(96087, 1_300_000, 0)).toBe(0);
});

test("proportional refund: rejects refund above amount or negatives", () => {
  expect(() => proportionalRefundMinor(100, 1000, 1001)).toThrow();
  expect(() => proportionalRefundMinor(-1, 1000, 500)).toThrow();
  expect(() => proportionalRefundMinor(100, 1000, -1)).toThrow();
  expect(() => proportionalRefundMinor(100, -1000, 0)).toThrow();
});
