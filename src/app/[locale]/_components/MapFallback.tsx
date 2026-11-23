import { useTranslations } from "next-intl";

/** Shown instead of the map when no Google Maps key is configured (or the map cannot load). */
export function MapFallback() {
  const t = useTranslations("search");
  return (
    <div
      role="status"
      className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-600"
    >
      {t("mapUnavailable")}
    </div>
  );
}
