import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LEGAL_CONTENT, type LegalDoc } from "@/content/legal";
import { routing } from "@/i18n/routing";

type LocaleParams = { params: Promise<{ locale: string }> };

export async function legalMetadata({ params }: LocaleParams, doc: LegalDoc, path: string): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "legal.metaTitle" });
  return {
    title: t(doc),
    alternates: { canonical: `/${locale}${path}`, languages: { en: `/en${path}`, ko: `/ko${path}` } },
  };
}

/** `params` is read inside <Suspense> so the page shell stays URL-independent (see ../../page.tsx). */
export function LegalPage({ params, doc }: LocaleParams & { doc: LegalDoc }) {
  return (
    <Suspense>
      <LegalBody params={params} doc={doc} />
    </Suspense>
  );
}

async function LegalBody({ params, doc }: LocaleParams & { doc: LegalDoc }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  const Content = LEGAL_CONTENT[locale][doc];

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900">{t(`metaTitle.${doc}`)}</h1>
      <p role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
        {t("draftBanner")}
      </p>
      <p className="text-xs text-zinc-500">{t("lastUpdated")}</p>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-700 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-900 [&_li]:break-words [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        <Content />
      </div>
    </article>
  );
}
