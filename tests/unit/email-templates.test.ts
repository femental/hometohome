import { expect, test } from "vitest";
import { renderEmail, type TemplateData, type TemplateName } from "@/server/email/templates";

const base: TemplateData = {
  guestName: "Gina",
  houseName: "Hongdae House",
  roomName: "Room 101",
  moveIn: "2027-03-15",
  lastNight: "2027-06-14",
};

const full: TemplateData = {
  ...base,
  firstPaymentTotal: 1_300_000,
  deposit: 500_000,
  holdExpiresAt: new Date("2027-03-02T03:00:00Z"),
  payUrl: "http://localhost:3000/en/bookings/b1/pay",
  bookingUrl: "http://localhost:3000/en/bookings/b1",
  reason: "Dates conflict",
  refundKrw: 1_300_000,
};

const ALL: TemplateName[] = [
  "request_received",
  "request_approved",
  "request_rejected",
  "request_expired",
  "payment_expired",
  "booking_confirmed",
  "booking_cancelled",
  "late_payment_refund",
  "admin_new_request",
  "admin_payment_received",
  "admin_booking_cancelled",
  "admin_late_payment_refund",
];

test("request_approved (en) shows KST deadline, amount and pay link", () => {
  const m = renderEmail("request_approved", "en", {
    ...base,
    firstPaymentTotal: 1_300_000,
    holdExpiresAt: new Date("2027-03-02T03:00:00Z"),
    payUrl: "http://localhost:3000/en/bookings/b1/pay",
  });
  expect(m.text).toContain("2027-03-02 12:00 (KST)");
  expect(m.text).toContain("₩1,300,000");
  expect(m.text).toContain("Mar 15, 2027");
  expect(m.html).toContain('href="http://localhost:3000/en/bookings/b1/pay"');
});

test("request_approved (ko) is Korean", () => {
  const m = renderEmail("request_approved", "ko", { ...full });
  expect(m.subject).toMatch(/[가-힣]/);
  expect(m.text).toContain("2027년 3월 15일");
});

test("every template renders in en and ko without 'undefined'", () => {
  for (const name of ALL) {
    for (const locale of ["en", "ko"] as const) {
      const m = renderEmail(name, locale, full);
      for (const part of [m.subject, m.text, m.html]) {
        expect(part, `${name}/${locale}`).not.toContain("undefined");
        expect(part, `${name}/${locale}`).not.toContain("NaN");
        expect(part.length).toBeGreaterThan(0);
      }
    }
  }
});

test("guest-supplied text is HTML-escaped, text part is not", () => {
  const m = renderEmail("request_rejected", "en", {
    ...full,
    guestName: "<script>alert(1)</script>",
    reason: `Tom & "Jerry's"`,
  });
  expect(m.html).toContain("&lt;script&gt;");
  expect(m.html).not.toContain("<script>");
  expect(m.html).toContain("Tom &amp; &quot;Jerry&#39;s&quot;");
  expect(m.text).toContain("<script>alert(1)</script>");
});

test("urls in href are attribute-escaped", () => {
  const m = renderEmail("request_approved", "en", { ...full, payUrl: 'http://x.test/?a=1&b="2"' });
  expect(m.html).toContain('href="http://x.test/?a=1&amp;b=&quot;2&quot;"');
});

test("throws when a required field is missing", () => {
  expect(() => renderEmail("request_approved", "en", base)).toThrow(/payUrl/);
});

test("request_approved states the 24-hour window in en and ko", () => {
  for (const locale of ["en", "ko"] as const) {
    expect(renderEmail("request_approved", locale, full).text).toContain("24");
  }
});

test("late_payment_refund shows the refund and requires refundKrw", () => {
  for (const locale of ["en", "ko"] as const) {
    expect(renderEmail("late_payment_refund", locale, full).text).toContain("₩1,300,000");
  }
  expect(() => renderEmail("late_payment_refund", "en", base)).toThrow(/refundKrw/);
});

test("booking_cancelled uses neutral refund wording", () => {
  const withRefund = renderEmail("booking_cancelled", "en", { ...base, refundKrw: 500_000 });
  expect(withRefund.text).toContain("₩500,000");
  expect(withRefund.text).not.toContain("original payment method");
  for (const refundKrw of [undefined, 0]) {
    const m = renderEmail("booking_cancelled", "en", { ...base, refundKrw });
    expect(m.text).toContain("No refund applies");
    expect(m.text).not.toContain("₩");
  }
});
