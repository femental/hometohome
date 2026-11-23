import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { DISTRICTS } from "@/domain/amenities";
import type { ISODate } from "@/domain/dates";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { RoomSearchParams } from "@/server/rooms/search";

/**
 * Plain GET form (works without client JS): submitting rewrites the query string, which the page
 * re-parses. Values shown are the *accepted* filters, so an ignored bad input is cleared.
 */
export function SearchForm({ params, earliestMoveIn }: { params: RoomSearchParams; earliestMoveIn: ISODate }) {
  const t = useTranslations("search");
  const locale = useLocale() as Locale;
  const selected = new Set(params.districts ?? []);

  return (
    <form method="get" role="search" aria-label={t("filters")} className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("moveIn")} name="moveIn" type="date" min={earliestMoveIn} defaultValue={params.moveIn ?? ""} />
        <Field label={t("lastNight")} name="lastNight" type="date" min={earliestMoveIn} defaultValue={params.lastNight ?? ""} />
        <Field label={t("minRent")} name="minRent" type="number" inputMode="numeric" min={0} step={10000} defaultValue={params.minRent ?? ""} />
        <Field label={t("maxRent")} name="maxRent" type="number" inputMode="numeric" min={0} step={10000} defaultValue={params.maxRent ?? ""} />
        <Field label={t("type")} name="type" as="select" defaultValue={params.roomType ?? ""}>
          <option value="">{t("anyOption")}</option>
          <option value="single">{t("single")}</option>
          <option value="double">{t("double")}</option>
        </Field>
        <Field label={t("gender")} name="gender" as="select" defaultValue={params.genderPolicy ?? ""}>
          <option value="">{t("anyOption")}</option>
          <option value="male">{t("male")}</option>
          <option value="female">{t("female")}</option>
          <option value="any">{t("genderAny")}</option>
        </Field>
        <Field label={t("occupants")} name="occupants" as="select" defaultValue={params.occupants ? String(params.occupants) : ""}>
          <option value="">{t("anyOption")}</option>
          <option value="1">{t("one")}</option>
          <option value="2">{t("two")}</option>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">{t("datesHint")}</p>

      <details open={selected.size > 0} className="rounded-md border border-zinc-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-700">
          {t("districts")}
          <span className="ml-2 font-normal text-zinc-500">
            {selected.size > 0 ? t("districtsSelected", { count: selected.size }) : t("districtsAny")}
          </span>
        </summary>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-zinc-200 p-3 sm:grid-cols-3 lg:grid-cols-5">
          {DISTRICTS.map((d) => (
            <li key={d.code}>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="district" value={d.code} defaultChecked={selected.has(d.code)} className="h-4 w-4" />
                {d[locale]}
              </label>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">{t("submit")}</Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          {t("reset")}
        </Link>
      </div>
    </form>
  );
}
