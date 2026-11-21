import { expect, test } from "vitest";
import {
  addDays,
  addMonthsClamped,
  diffDays,
  endOfDayKST,
  isValidISODate,
  startOfDayKST,
  todayKST,
} from "@/domain/dates";

test("addMonthsClamped clamps to month end", () => {
  expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
  expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  expect(addMonthsClamped("2027-03-15", 2)).toBe("2027-05-15");
  expect(addMonthsClamped("2027-08-31", 1)).toBe("2027-09-30");
  expect(addMonthsClamped("2027-12-15", 1)).toBe("2028-01-15");
});
test("diffDays / addDays", () => {
  expect(diffDays("2027-04-15", "2027-04-25")).toBe(10);
  expect(addDays("2027-03-15", -7)).toBe("2027-03-08");
});
test("todayKST uses Seoul date", () => {
  expect(todayKST(new Date("2027-03-07T15:30:00Z"))).toBe("2027-03-08");
  expect(todayKST(new Date("2027-03-07T14:59:59Z"))).toBe("2027-03-07");
});
test("endOfDayKST / startOfDayKST", () => {
  expect(endOfDayKST("2027-03-08").toISOString()).toBe("2027-03-08T14:59:59.999Z");
  expect(startOfDayKST("2027-03-15").toISOString()).toBe("2027-03-14T15:00:00.000Z");
});
test("isValidISODate", () => {
  expect(isValidISODate("2027-02-29")).toBe(false);
  expect(isValidISODate("2028-02-29")).toBe(true);
});
test("malformed ISODate throws", () => {
  expect(() => addDays("2027-02-30", 1)).toThrow(Error);
});
