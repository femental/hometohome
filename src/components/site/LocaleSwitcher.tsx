"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

const LABELS: Record<Locale, string> = { en: "EN", ko: "한국어" };

/**
 * Switches to the same page (path and query kept) in the other locale. next-intl's proxy stores the
 * choice in the `NEXT_LOCALE` cookie, so `/` lands on it next time.
 * TODO(Task 2): when signed in, also call `updateLocaleAction(locale)` to save users.locale.
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const t = useTranslations("nav");
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    startTransition(() => {
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
