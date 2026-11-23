"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { updateLocaleAction } from "@/app/[locale]/account/actions";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

const LABELS: Record<Locale, string> = { en: "EN", ko: "한국어" };

/**
 * Switches to the same page (path and query kept) in the other locale. next-intl's proxy stores the
 * choice in the `NEXT_LOCALE` cookie, so `/` lands on it next time. When signed in, the choice is
 * also saved to users.locale (the language of their emails) before switching.
 */
export function LocaleSwitcher({ className = "", signedIn = false }: { className?: string; signedIn?: boolean }) {
  const t = useTranslations("nav");
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    startTransition(async () => {
      if (signedIn) {
        // Best effort: the switch itself must still work if saving fails (e.g. the session expired).
        await updateLocaleAction(locale).catch(() => {});
      }
      router.replace(`${pathname}${window.location.search}`, { locale, scroll: false });
    });
  }

  return (
    <div role="group" aria-label={t("language")} aria-busy={pending || undefined} className={`flex gap-1 ${className}`}>
      {routing.locales.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={locale === current}
          disabled={pending || locale === current}
          onClick={() => switchTo(locale)}
          className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-default aria-pressed:bg-zinc-900 aria-pressed:text-white"
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
