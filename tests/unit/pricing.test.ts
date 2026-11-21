import { expect, test } from "vitest";
import { calculatePrice } from "@/domain/pricing";

const base = { monthlyRent: 800_000, extraPersonMonthlyFee: 0, deposit: 500_000, occupants: 1 as const };
test.each([
  ["2027-03-15", "2027-05-15", 2, 0, 1_600_000, 1_300_000],
  ["2027-03-15", "2027-04-25", 1, 10, 1_066_667, 1_566_667],
  ["2027-03-15", "2027-05-25", 2, 10, 1_866_667, 1_300_000],
  ["2027-01-31", "2027-02-28", 1, 0, 800_000, 1_300_000],
])("%s → %s", (moveIn, moveOut, months, days, total, first) => {
  const q = calculatePrice({ ...base, moveIn, moveOut });
  expect([q.fullMonths, q.extraDays, q.stayTotal, q.firstPaymentTotal]).toEqual([months, days, total, first]);
});
test("2 occupants add extra fee to rent, not deposit", () => {
  const q = calculatePrice({ ...base, extraPersonMonthlyFee: 100_000, occupants: 2, moveIn: "2027-03-15", moveOut: "2027-05-15" });
  expect(q.appliedMonthlyRent).toBe(900_000);
  expect(q.deposit).toBe(500_000);
  expect(q.firstPaymentTotal).toBe(900_000 + 500_000);
});
test("1 occupant ignores extra fee", () => {
  const q = calculatePrice({ ...base, extraPersonMonthlyFee: 100_000, moveIn: "2027-03-15", moveOut: "2027-05-15" });
  expect(q.appliedMonthlyRent).toBe(800_000);
});
test("rejects < 1 month, > 12 months, and moveOut <= moveIn", () => {
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2027-04-14" })).toThrow(expect.objectContaining({ code: "MIN_STAY" }));
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2028-03-16" })).toThrow(expect.objectContaining({ code: "MAX_STAY" }));
  expect(calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2028-03-15" }).fullMonths).toBe(12);
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "2027-03-15" })).toThrow(expect.objectContaining({ code: "INVALID_RANGE" }));
});
test("malformed dates and reversed range are INVALID_RANGE", () => {
  expect(() => calculatePrice({ ...base, moveIn: "2027-02-30", moveOut: "2027-05-15" })).toThrow(expect.objectContaining({ code: "INVALID_RANGE" }));
  expect(() => calculatePrice({ ...base, moveIn: "2027-03-15", moveOut: "garbage" })).toThrow(expect.objectContaining({ code: "INVALID_RANGE" }));
  expect(() => calculatePrice({ ...base, moveIn: "2027-05-15", moveOut: "2027-03-15" })).toThrow(expect.objectContaining({ code: "INVALID_RANGE" }));
});
test("month counting is from original moveIn, not chained (clamp drift)", () => {
  // 1/31 +2 months clamps to 3/31; chaining would give 3/28 and over-count.
  const q = calculatePrice({ ...base, moveIn: "2027-01-31", moveOut: "2027-03-30" });
  expect([q.fullMonths, q.extraDays]).toEqual([1, 30]);
});
