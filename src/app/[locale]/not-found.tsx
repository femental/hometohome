"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * 404 inside a locale (`notFound()` from a guest page): rendered within the locale layout, so the
 * header, footer and messages are there. Next.js adds `noindex` to 404 responses itself.
 */
export default function LocaleNotFound() {
  const t = useTranslations("common.notFound");
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold text-zinc-900">{t("title")}</h1>
      <p className="text-sm text-zinc-600">{t("body")}</p>
      <Link href="/" className="text-sm font-medium text-zinc-900 underline">
        {t("home")}
      </Link>
    </div>
  );
}
