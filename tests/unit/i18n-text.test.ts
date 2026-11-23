import { afterEach, expect, test, vi } from "vitest";
import { formatUsdReference, pickText } from "@/lib/i18n-text";

afterEach(() => vi.unstubAllEnvs());

test("pickText", () => {
  expect(pickText({ en: "Room", ko: "방" }, "ko")).toBe("방");
  expect(pickText({ en: "Room", ko: "방" }, "en")).toBe("Room");
  expect(pickText({ en: "Room" }, "ko")).toBe("Room");
  expect(pickText({ en: "Room", ko: "" }, "ko")).toBe("Room");
  expect(pickText(null, "ko")).toBe("");
  expect(pickText(undefined, "en")).toBe("");
});

test("formatUsdReference uses the default rate 1380", () => {
  vi.stubEnv("NEXT_PUBLIC_USD_KRW_REFERENCE", "");
  expect(formatUsdReference(1_300_000)).toBe("≈ $942");
});

test("formatUsdReference groups thousands and rounds to whole dollars", () => {
  vi.stubEnv("NEXT_PUBLIC_USD_KRW_REFERENCE", "1000");
  expect(formatUsdReference(1_050_400)).toBe("≈ $1,050");
  expect(formatUsdReference(1_050_600)).toBe("≈ $1,051");
});

test("formatUsdReference falls back to 1380 for an invalid rate", () => {
  vi.stubEnv("NEXT_PUBLIC_USD_KRW_REFERENCE", "abc");
  expect(formatUsdReference(1_380_000)).toBe("≈ $1,000");
  vi.stubEnv("NEXT_PUBLIC_USD_KRW_REFERENCE", "0");
  expect(formatUsdReference(1_380_000)).toBe("≈ $1,000");
});
