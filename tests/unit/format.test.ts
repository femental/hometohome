import { expect, test } from "vitest";
import { formatDate, formatKRW, formatKST, formatMinor, formatRemainingKo } from "@/lib/format";
import { statusBadge } from "@/components/ui/Badge";
import type { BookingStatus } from "@/domain/booking-status";

test("formatKST converts UTC to Seoul", () => {
  expect(formatKST(new Date("2027-03-02T03:00:00Z"))).toBe("2027-03-02 12:00 (KST)");
  expect(formatKST(new Date("2027-03-01T15:30:00Z"))).toBe("2027-03-02 00:30 (KST)");
});

test("formatKRW", () => {
  expect(formatKRW(1300000)).toBe("₩1,300,000");
});

test("formatDate en", () => {
  expect(formatDate("2027-03-15", "en")).toBe("Mar 15, 2027");
});

test("formatDate ko", () => {
  expect(formatDate("2027-03-15", "ko")).toBe("2027년 3월 15일");
});

test("every BookingStatus has a Korean label and class", () => {
  const labels: Record<BookingStatus, string> = {
    requested: "신청됨",
    rejected: "거절됨",
    request_expired: "신청 만료",
    withdrawn: "철회됨",
    awaiting_payment: "결제 대기",
    payment_expired: "결제 만료",
    confirmed: "확정",
    cancelled: "취소됨",
    completed: "퇴실 완료",
  };
  for (const [status, label] of Object.entries(labels) as [BookingStatus, string][]) {
    const b = statusBadge(status);
    expect(b.label).toBe(label);
    expect(b.className).not.toBe("");
  }
});

test("formatMinor: KRW in won, USD minor units as dollars", () => {
  expect(formatMinor("KRW", 1300000)).toBe("₩1,300,000");
  expect(formatMinor("USD", 12345)).toBe("$123.45");
  expect(formatMinor("USD", 123456705)).toBe("$1,234,567.05");
  expect(formatMinor("USD", 5)).toBe("$0.05");
});

test("formatMinor: unknown currency throws instead of guessing decimals", () => {
  expect(() => formatMinor("JPY", 100)).toThrow(/JPY/);
});

test("formatRemainingKo: hours, then minutes, then expired", () => {
  const now = new Date("2027-03-01T00:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms);
  expect(formatRemainingKo(at(23 * 3_600_000 + 59 * 60_000), now)).toBe("23시간 남음");
  expect(formatRemainingKo(at(3_600_000), now)).toBe("1시간 남음");
  expect(formatRemainingKo(at(59 * 60_000 + 30_000), now)).toBe("59분 남음");
  expect(formatRemainingKo(at(30_000), now)).toBe("1분 미만 남음");
  expect(formatRemainingKo(at(0), now)).toBe("기한 지남");
});
