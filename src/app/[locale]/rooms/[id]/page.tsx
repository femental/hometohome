import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { DISTRICTS } from "@/domain/amenities";
import { addDays, todayKST } from "@/domain/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatDate, formatKRW } from "@/lib/format";
import { formatUsdReference, pickText } from "@/lib/i18n-text";
import { getGuestUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { getPublicRoom } from "@/server/guest/catalog";
import { quoteInput, quoteRoom } from "@/server/guest/requests";
import { HouseInfo } from "../../_components/HouseInfo";
import { PhotoGallery } from "./_components/PhotoGallery";
import type { PreviewState } from "./_components/PricePreview";
import { RequestForm } from "./_components/RequestForm";

const BADGE = "bg-zinc-100 text-zinc-700";

/** Shared by metadata and page within one request. */
const loadRoom = cache((id: string) => getPublicRoom(prisma, id));

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export async function generateMetadata({ params }: PageProps<"/[locale]/rooms/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const [room, t] = await Promise.all([loadRoom(id), getTranslations({ locale, namespace: "room" })]);
  if (!room) return { title: t("metaFallback"), robots: { index: false } };
  return {
    title: `${pickText(room.name, locale)} · ${pickText(room.house.name, locale)}`,
    description: pickText(room.description, locale).slice(0, 160),
    alternates: {
      canonical: `/${locale}/rooms/${id}`,
      languages: { en: `/en/rooms/${id}`, ko: `/ko/rooms/${id}` },
    },
  };
}

// Localized page pattern: params and searchParams are read inside <Suspense> (see ../../page.tsx).
export default function RoomPage({ params, searchParams }: PageProps<"/[locale]/rooms/[id]">) {
  return (
    <Suspense>
      <RoomDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RoomDetail({
  params,
  searchParams,
}: Pick<PageProps<"/[locale]/rooms/[id]">, "params" | "searchParams">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [room, user, sp, t, tSearch, tRequest] = await Promise.all([
    loadRoom(id),
    getGuestUser(),
    searchParams,
    getTranslations("room"),
    getTranslations("search"),
    getTranslations("request"),
  ]);
  if (!room) notFound();

  const now = new Date();
  const earliest = addDays(todayKST(now), 3);
  const minMoveIn = room.availableFrom > earliest ? room.availableFrom : earliest;

  // The stay carried over from search (or the login round trip). Prices come from the server only.
  const stay = quoteInput.safeParse({
    roomId: room.id,
    moveIn: first(sp.moveIn),
    lastNight: first(sp.lastNight),
    occupants: first(sp.occupants) === "2" && room.maxOccupants >= 2 ? 2 : 1,
  });
  let initialPreview: PreviewState = { kind: "empty" };
  if (stay.success) {
    const r = await quoteRoom(prisma, stay.data, now);
    initialPreview = r.ok ? { kind: "quote", quote: r.quote } : { kind: "error", error: r.error };
  }
  const initialStay = stay.success
    ? { moveIn: stay.data.moveIn, lastNight: stay.data.lastNight, occupants: stay.data.occupants }
    : { moveIn: "", lastNight: "", occupants: 1 as const };
  const houseQuery = stay.success
    ? `?${new URLSearchParams({ moveIn: stay.data.moveIn, lastNight: stay.data.lastNight })}`
    : "";

  const district = DISTRICTS.find((d) => d.code === room.house.district);
  const description = pickText(room.description, locale);

  return (
    <div className="flex flex-col gap-6">
      <PhotoGallery photos={[...room.photos, ...room.house.photos]} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1">
          <div>
            <h1 className="break-words text-2xl font-semibold text-zinc-900">{pickText(room.name, locale)}</h1>
            <p className="text-sm text-zinc-600">
              <Link href={`/houses/${room.house.id}${houseQuery}`} className="font-medium text-blue-700 underline">
                {pickText(room.house.name, locale)}
              </Link>{" "}
              · {district ? district[locale] : room.house.district}
            </p>
          </div>
          <p className="text-zinc-900">
            <span className="text-xl font-semibold">{formatKRW(room.monthlyRent)}</span>{" "}
            <span className="text-sm text-zinc-500">
              {tSearch("perMonth")} {formatUsdReference(room.monthlyRent)}
            </span>
          </p>
          <ul className="flex flex-col gap-1 text-sm text-zinc-700">
            <li>
              {t("deposit")} {formatKRW(room.deposit)}{" "}
              <span className="text-zinc-500">{formatUsdReference(room.deposit)}</span>
            </li>
            <li>{t("availableFrom", { date: formatDate(room.availableFrom, locale) })}</li>
            {room.maxOccupants >= 2 && room.extraPersonMonthlyFee > 0 && (
              <li>{t("extraPerson", { amount: formatKRW(room.extraPersonMonthlyFee) })}</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Badge className={BADGE}>{tSearch(room.roomType === "double" ? "double" : "single")}</Badge>
            <Badge className={BADGE}>
              {tSearch(room.genderPolicy === "male" ? "male" : room.genderPolicy === "female" ? "female" : "genderAny")}
            </Badge>
            <Badge className={BADGE}>{tSearch(room.privateBathroom ? "privateBath" : "sharedBath")}</Badge>
          </div>
          {description && (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{t("about")}</h2>
              <p className="whitespace-pre-line break-words text-sm text-zinc-700">{description}</p>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <Card title={tRequest("heading")}>
            <RequestForm
              roomId={room.id}
              signedIn={user !== null}
              defaultName={user?.name ?? ""}
              initialStay={initialStay}
              initialPreview={initialPreview}
              minMoveIn={minMoveIn}
              maxOccupants={room.maxOccupants}
              genderPolicy={room.genderPolicy}
            />
          </Card>
        </aside>

        <div className="min-w-0 lg:col-start-1">
          <HouseInfo house={room.house} />
        </div>
      </div>
    </div>
  );
}
