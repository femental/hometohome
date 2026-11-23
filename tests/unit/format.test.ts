import { expect, test } from "vitest";
import { formatDate, formatKRW, formatKST } from "@/lib/format";
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
