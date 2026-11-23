// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ResultsMap } from "@/app/[locale]/_components/ResultsMap";
import en from "../../messages/en.json";

const houses = [
  { houseId: "h1", name: "Maple House", district: "Mapo-gu", lat: 37.55, lng: 126.92, minRent: 700_000, roomCount: 2, photoUrl: null },
];

function renderMap() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResultsMap houses={houses} stayQuery="" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("ResultsMap", () => {
  test("without API key renders fallback, not a map", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
    renderMap();
    expect(screen.getByText(en.search.mapUnavailable)).toBeTruthy();
    expect(screen.queryByLabelText(en.search.mapLabel)).toBeNull();
    expect(document.querySelector("script[src*='maps.googleapis.com']")).toBeNull();
  });
});
