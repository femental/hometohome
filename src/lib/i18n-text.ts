import type { Locale } from "@/i18n/routing";

/** A bilingual DB field (`{ en, ko? }`): Korean when asked for and non-empty, otherwise English. */
export function pickText(t: { en: string; ko?: string } | null | undefined, locale: Locale): string {
  if (!t) return "";
  return locale === "ko" && t.ko ? t.ko : t.en;
}

const DEFAULT_USD_KRW = 1380;

/** Fixed KRW per USD until live FX (phase 4). Read at call time; NEXT_PUBLIC_ so it is inlined for the browser. */
function usdKrwReference(): number {
  const rate = Number(process.env.NEXT_PUBLIC_USD_KRW_REFERENCE);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_KRW;
}

/** Reference USD next to a KRW amount: `≈ $942` (whole dollars). */
export function formatUsdReference(krw: number): string {
  const usd = Math.round(krw / usdKrwReference());
  const sign = usd < 0 ? "-" : "";
  return `≈ ${sign}$${String(Math.abs(usd)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
