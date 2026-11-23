import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DISTRICTS } from "@/domain/amenities";
import { addDays, todayKST } from "@/domain/dates";
import { routing } from "@/i18n/routing";
import { groupByHouse } from "@/lib/map-houses";
import { photoUrl } from "@/lib/photo-url";
import { prisma } from "@/server/db";
import { parseSearchParams } from "@/server/guest/search-params";
import { searchRooms } from "@/server/rooms/search";
import { ResultList } from "./_components/ResultList";
import { ResultsMap } from "./_components/ResultsMap";
import { ResultsView } from "./_components/ResultsView";
import { SearchForm } from "./_components/SearchForm";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "search" });
  return {
    title: t("metaTitle"),
    alternates: { canonical: `/${locale}`, languages: { en: "/en", ko: "/ko" } },
  };
}

// Localized page pattern (cacheComponents + partialPrefetching): `params` and `searchParams` are read
// inside <Suspense> so the App Shell stays URL-independent; both locales are still prerendered via
// generateStaticParams. The search itself runs per request (it depends on the query and the clock).
export default function HomePage({ params, searchParams }: PageProps<"/[locale]">) {
  return (
    <Suspense>
      <Search params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Search({
  params,
  searchParams,
}: Pick<PageProps<"/[locale]">, "params" | "searchParams">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, sp] = await Promise.all([getTranslations("search"), searchParams]);

  const now = new Date();
  const today = todayKST(now);
  const { params: filters, issues } = parseSearchParams(sp, today);
  const rooms = await searchRooms(prisma, filters, now);

  const stayQuery =
    filters.moveIn && filters.lastNight
      ? `?${new URLSearchParams({ moveIn: filters.moveIn, lastNight: filters.lastNight })}`
      : "";
  const houses = groupByHouse(
    rooms,
    locale,
    (code) => DISTRICTS.find((d) => d.code === code)?.[locale] ?? code,
    photoUrl,
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900">{t("heading")}</h1>
      <SearchForm params={filters} earliestMoveIn={addDays(today, 3)} />
      {issues.length > 0 && (
        <ul role="status" className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {issues.map((issue) => (
            <li key={issue}>{t(`issues.${issue}`)}</li>
          ))}
        </ul>
      )}
      <p className="text-sm font-medium text-zinc-700" aria-live="polite">
        {t("resultCount", { count: rooms.length })}
      </p>
      <ResultsView
        list={<ResultList rooms={rooms} stayQuery={stayQuery} />}
        map={<ResultsMap houses={houses} stayQuery={stayQuery} />}
      />
    </div>
  );
}
