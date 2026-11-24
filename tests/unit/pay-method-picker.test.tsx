// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, test, vi } from "vitest";
import en from "../../messages/en.json";

vi.mock("@/app/[locale]/bookings/[id]/pay/actions", () => ({
  preparePaymentAction: vi.fn(),
  completePaymentAction: vi.fn(),
  fakeCheckoutAction: vi.fn(),
}));
vi.mock("@portone/browser-sdk/v2", () => ({ default: { requestPayment: vi.fn(), loadPaymentUI: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { MethodPicker, type MethodOptions } from "@/app/[locale]/bookings/[id]/pay/_components/MethodPicker";

const BOOKING = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

function renderPicker(methods: MethodOptions, expired = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MethodPicker bookingId={BOOKING} locale="en" methods={methods} fake={false} expired={expired} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

test("shows only the methods that have a channel, with their charged amounts", () => {
  renderPicker({ card: { amountLabel: "₩1,300,000" } });
  expect(screen.getByRole("button", { name: /card/i })).toBeTruthy();
  expect(screen.getByText("₩1,300,000")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /paypal/i })).toBeNull();
});

test("PayPal shows the USD amount and the rate it was quoted at", () => {
  renderPicker({
    card: { amountLabel: "₩1,300,000" },
    paypal: { amountLabel: "$960.87", rateLabel: "1 USD = ₩1,380 (2027-03-01)" },
  });
  expect(screen.getByRole("button", { name: /paypal/i })).toBeTruthy();
  expect(screen.getByText("$960.87")).toBeTruthy();
  expect(screen.getByText(/1 USD = ₩1,380/)).toBeTruthy();
});

test("payment buttons are disabled once the hold has expired", () => {
  renderPicker({ card: { amountLabel: "₩1,300,000" } }, true);
  expect((screen.getByRole("button", { name: /card/i }) as HTMLButtonElement).disabled).toBe(true);
});
