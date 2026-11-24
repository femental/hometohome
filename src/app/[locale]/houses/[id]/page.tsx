import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/Badge";
import { DISTRICTS } from "@/domain/amenities";
import { addDays, isValidISODate, todayKST } from "@/domain/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatDate, formatKRW } from "@/lib/format";
import { formatUsdReference, pickText } from "@/lib/i18n-text";
import { prisma } from "@/server/db";
import { getPublicHouse } from "@/server/guest/catalog";
import { HouseInfo } from "../../_components/HouseInfo";
import { PhotoGallery } from "../../rooms/[id]/_components/PhotoGallery";

const BADGE = "bg-zinc-100 text-zinc-700";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** The searched stay, when both dates are valid, in order and not too soon (as the search page requires). */
function stayFrom(sp: Record<string, string | string[] | undefined>, now: Date) {
  const moveIn = first(sp.moveIn);
  const lastNight = first(sp.lastNight);
  if (!isValidISODate(moveIn) || !isValidISODate(lastNight) || lastNight < moveIn) return null;
  if (moveIn < addDays(todayKST(now), 3)) return null;
  return { moveIn, lastNight };
}

export async function generateMetadata({ params }: PageProps<"/[locale]/houses/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  await connection(); // the clock below is request-time data (metadata)
  const [house, t] = await Promise.all([
    getPublicHouse(prisma, id, { now: new Date() }),
    getTranslations({ locale, namespace: "house" }),
  ]);
  if (!house) return { title: t("metaFallback"), robots: { index: false } };
  return {
    title: pickText(house.name, locale),
    description: pickText(house.description, locale).slice(0, 160),
    alternates: {
      canonical: `/${locale}/houses/${id}`,
      languages: { en: `/en/houses/${id}`, ko: `/ko/houses/${id}` },
    },
  };
}

// Localized page pattern: params and searchParams are read inside <Suspense> (see ../../page.tsx).
export default function HousePage({ params, searchParams }: PageProps<"/[locale]/houses/[id]">) {
  return (
    <Suspense>
      <HouseDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function HouseDetail({
  params,
  searchParams,
}: Pick<PageProps<"/[locale]/houses/[id]">, "params" | "searchParams">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [sp, t, tSearch] = await Promise.all([searchParams, getTranslations("house"), getTranslations("search")]);
  await connection(); // availability depends on the clock: request-time only
  const now = new Date();
  const stay = stayFrom(sp, now);
  // With a stay, each room also carries `available` for it.
  const house = await getPublicHouse(prisma, id, { ...stay, now });
  if (!house) notFound();

  const stayQuery = stay ? `?${new URLSearchParams(stay)}` : "";
  const district = DISTRICTS.find((d) => d.code === house.district);
  const description = pickText(house.description, locale);

  return (
    <div className="flex flex-col gap-6">
      <PhotoGallery photos={house.photos} />

      <div>
        <h1 className="break-words text-2xl font-semibold text-zinc-900">{pickText(house.name, locale)}</h1>
        <p className="text-sm text-zinc-600">{district ? district[locale] : house.district}</p>
      </div>

      {description && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-zinc-900">{t("about")}</h2>
          <p className="whitespace-pre-line break-words text-sm text-zinc-700">{description}</p>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="house-rooms">
        <h2 id="house-rooms" className="text-lg font-semibold text-zinc-900">
          {t("rooms")}
        </h2>
        {stay && (
          <p className="text-sm text-zinc-600">
            {t("availabilityFor", { from: formatDate(stay.moveIn, locale), to: formatDate(stay.lastNight, locale) })}
          </p>
        )}
        {house.rooms.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("noRooms")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {house.rooms.map((room) => (
              <li key={room.id}>
                <article className="relative flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                  <div className="relative aspect-[4/3] w-full bg-zinc-100">
                    {room.coverPhotoUrl ? (
                      <Image src={room.coverPhotoUrl} alt="" fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
                        {tSearch("photoMissing")}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
                    <h3 className="truncate text-base font-semibold text-zinc-900">
                      <Link
                        href={`/rooms/${room.id}${stayQuery}`}
                        className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-zinc-900"
                      >
                        {pickText(room.name, locale)}
                      </Link>
                    </h3>
                    <p className="text-zinc-900">
                      <span className="text-lg font-semibold">{formatKRW(room.monthlyRent)}</span>{" "}
                      <span className="text-sm text-zinc-500">
                        {tSearch("perMonth")} {formatUsdReference(room.monthlyRent)}
                      </span>
                    </p>
                    <p className="text-sm text-zinc-600">
                      {tSearch("deposit", { amount: formatKRW(room.deposit) })} ·{" "}
                      {tSearch("availableFrom", { date: formatDate(room.availableFrom, locale) })}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {room.available !== undefined && (
                        <Badge className={room.available ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                          {t(room.available ? "available" : "unavailable")}
                        </Badge>
                      )}
                      <Badge className={BADGE}>{tSearch(room.roomType === "double" ? "double" : "single")}</Badge>
                      <Badge className={BADGE}>
                        {tSearch(room.genderPolicy === "male" ? "male" : room.genderPolicy === "female" ? "female" : "genderAny")}
                      </Badge>
                      <Badge className={BADGE}>{tSearch(room.privateBathroom ? "privateBath" : "sharedBath")}</Badge>
                      <Badge className={BADGE}>{t("upTo", { count: room.maxOccupants })}</Badge>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HouseInfo house={house} />
    </div>
  );
}
