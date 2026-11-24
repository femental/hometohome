// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test } from "vitest";
import { BusinessInfoLines } from "@/components/site/BusinessInfoLines";
import { parseBusinessInfo } from "@/server/env";
import en from "../../messages/en.json";

function renderLines(raw: Record<string, string | undefined>) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BusinessInfoLines info={parseBusinessInfo(raw)} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("BusinessInfoLines", () => {
  test("renders only the keys that are set", () => {
    renderLines({ BUSINESS_NAME: "Home Co.", BUSINESS_EMAIL: "hi@example.com", BUSINESS_PHONE: "" });
    expect(screen.getByText("Home Co.")).toBeTruthy();
    expect(screen.getByText("hi@example.com")).toBeTruthy();
    expect(screen.getByText(en.footer.business.name)).toBeTruthy();
    expect(screen.queryByText(en.footer.business.phone)).toBeNull();
    expect(screen.queryByText(en.footer.business.regNo)).toBeNull();
  });

  test("renders nothing when no key is set", () => {
    const { container } = renderLines({ BUSINESS_NAME: "  ", BUSINESS_REP: "" });
    expect(container.innerHTML).toBe("");
  });
});
