import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Badge } from "@/components/ui/Badge";
import { DISTRICTS } from "@/domain/amenities";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatKRW } from "@/lib/format";
import { formatUsdReference, pickText } from "@/lib/i18n-text";
import { photoUrl } from "@/lib/photo-url";
import type { RoomSearchResult } from "@/server/rooms/search";

const BADGE = "bg-zinc-100 text-zinc-700";

/** One search result. `stayQuery` (`?moveIn=…&lastNight=…` or empty) keeps the searched stay on the link. */
export function RoomCard({ room, stayQuery }: { room: RoomSearchResult; stayQuery: string }) {
  const t = useTranslations("search");
  const locale = useLocale() as Locale;
  const district = DISTRICTS.find((d) => d.code === room.district);
  const roomName = pickText(room.roomName, locale);
  const houseName = pickText(room.houseName, locale);

  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm sm:flex-row">
      <div className="relative aspect-[4/3] w-full shrink-0 bg-zinc-100 sm:aspect-auto sm:min-h-36 sm:w-44">
        {room.coverPhotoPath ? (
          <Image
            src={photoUrl(room.coverPhotoPath)}
            alt=""
            fill
            sizes="(min-width: 640px) 176px, 100vw"
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
            {t("photoMissing")}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div>
          <h3 className="truncate text-base font-semibold text-zinc-900">
            <Link
              href={`/rooms/${room.roomId}${stayQuery}`}
              className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-zinc-900"
            >
              {roomName}
            </Link>
          </h3>
          <p className="truncate text-sm text-zinc-600">
            {houseName} · {district ? district[locale] : room.district}
          </p>
        </div>
        <p className="text-zinc-900">
          <span className="text-lg font-semibold">{formatKRW(room.monthlyRent)}</span>{" "}
          <span className="text-sm text-zinc-500">
            {t("perMonth")} {formatUsdReference(room.monthlyRent)}
          </span>
        </p>
        <p className="text-sm text-zinc-600">
          {t("deposit", { amount: formatKRW(room.deposit) })} · {t("availableFrom", { date: formatDate(room.availableFrom, locale) })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge className={BADGE}>{t(room.roomType)}</Badge>
          <Badge className={BADGE}>{t(room.genderPolicy === "any" ? "genderAny" : room.genderPolicy)}</Badge>
          <Badge className={BADGE}>{t(room.privateBathroom ? "privateBath" : "sharedBath")}</Badge>
        </div>
      </div>
    </article>
  );
}
