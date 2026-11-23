import { defineRouting } from "next-intl/routing";

/**
 * Guest-facing locales. Every guest URL is prefixed (`/en/...`, `/ko/...`); `/` redirects by the
 * saved `NEXT_LOCALE` cookie, then Accept-Language (ko → ko, anything else → en).
 * The Korean admin (/admin), /login, /auth/* and /api are outside this routing (see src/proxy.ts).
 */
export const routing = defineRouting({
  locales: ["en", "ko"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
