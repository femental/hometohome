import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { HtmlDocument } from "@/components/site/HtmlDocument";
import { routing } from "@/i18n/routing";

// The whole document (`<html lang>`, messages, header) depends on the locale param, so entering
// this segment from outside (another locale, /admin) may block. Navigations between pages of one
// locale are still validated per page — pages read `params` inside <Suspense> (see ./page.tsx).
export const instant = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("metaDescription"),
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Static rendering: every localized layout and page sets the locale before using next-intl.
  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <HtmlDocument lang={locale}>
      <NextIntlClientProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
        >
          {t("skipToContent")}
        </a>
        <Header />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
        <Footer />
      </NextIntlClientProvider>
    </HtmlDocument>
  );
}
