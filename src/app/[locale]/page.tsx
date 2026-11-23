import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { routing } from "@/i18n/routing";

// Placeholder home; Task 4 replaces it with the search page.
// Pattern for localized pages (cacheComponents + partialPrefetching): read `params` inside <Suspense>
// so the App Shell stays URL-independent; both locales are still prerendered via generateStaticParams.
export default function HomePage({ params }: PageProps<"/[locale]">) {
  return (
    <Suspense>
      <Home params={params} />
    </Suspense>
  );
}

async function Home({ params }: { params: PageProps<"/[locale]">["params"] }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-zinc-900">{t("appName")}</h1>
      <p className="text-zinc-600">{t("tagline")}</p>
    </div>
  );
}
