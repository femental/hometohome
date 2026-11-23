import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import type en from "../../messages/en.json";
import { routing, type Locale } from "./routing";

/**
 * Per-request next-intl config. Localized layouts and pages call `setRequestLocale(locale)` first
 * (static rendering under cacheComponents); `requestLocale` then resolves from that cache without
 * reading request headers. `[locale]` is not a root param here (the root layout `app/layout.tsx`
 * is shared with /admin and /login), so `next/root-params` is not available.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Asia/Seoul",
  };
});

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
