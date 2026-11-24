"use client";

import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";
import { useLocale, useTranslations } from "next-intl";

/**
 * One marker on the house's location. Without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY nothing is rendered:
 * the page always shows the address next to it.
 */
export function HouseMap({ lat, lng, title }: { lat: number; lng: number; title: string }) {
  const locale = useLocale();
  const t = useTranslations("house");
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const position = { lat, lng };
  return (
    <div role="region" aria-label={t("mapLabel")} className="h-64 w-full overflow-hidden rounded-lg border border-zinc-200">
      <APIProvider apiKey={apiKey} language={locale}>
        <Map
          defaultCenter={position}
          defaultZoom={15}
          gestureHandling="cooperative"
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={false}
        >
          <Marker position={position} title={title} />
        </Map>
      </APIProvider>
    </div>
  );
}
