import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AMENITY_LABELS } from "@/domain/amenities";
import type { Locale } from "@/i18n/routing";
import { pickText } from "@/lib/i18n-text";
import type { PublicHouse } from "@/server/guest/catalog";
import { HouseMap } from "./HouseMap";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}

/** Shared facilities, house rules, nearest stations and location (address + map) of a house. */
export function HouseInfo({ house }: { house: Omit<PublicHouse, "rooms"> }) {
  const t = useTranslations("house");
  const locale = useLocale() as Locale;
  const rules = pickText(house.houseRules, locale);

  return (
    <div className="flex flex-col gap-6">
      <Section title={t("amenities")}>
        {house.amenities.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {house.amenities.map((a) => (
              <li key={a} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700">
                {AMENITY_LABELS[a]?.[locale] ?? a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">{t("noAmenities")}</p>
        )}
      </Section>

      {rules && (
        <Section title={t("rules")}>
          <p className="whitespace-pre-line break-words text-sm text-zinc-700">{rules}</p>
        </Section>
      )}

      {house.nearestStations.length > 0 && (
        <Section title={t("stations")}>
          <ul className="flex flex-col gap-1 text-sm text-zinc-700">
            {house.nearestStations.map((s, i) => (
              <li key={`${s.name_en}-${i}`}>
                <span className="font-medium text-zinc-900">
                  {locale === "ko" && s.name_ko ? s.name_ko : s.name_en}
                </span>
                {s.line && <span className="text-zinc-500"> · {s.line}</span>}
                {s.walk_min !== undefined && <span className="text-zinc-500"> · {t("walk", { minutes: s.walk_min })}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("location")}>
        <p className="break-words text-sm text-zinc-700">
          <span className="text-zinc-500">{t("address")}: </span>
          <span lang="ko">{house.addressKo}</span>
        </p>
        <HouseMap lat={house.lat} lng={house.lng} title={pickText(house.name, locale)} />
      </Section>
    </div>
  );
}
