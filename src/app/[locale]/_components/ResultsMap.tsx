"use client";

import { AdvancedMarker, APIProvider, InfoWindow, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatKRW } from "@/lib/format";
import { formatUsdReference } from "@/lib/i18n-text";
import { compactKrw, type MapHouse } from "@/lib/map-houses";
import { MapFallback } from "./MapFallback";

const SEOUL = { lat: 37.5665, lng: 126.978 };

/** Fits the viewport to the markers; refits once if the map was first laid out in a hidden (0px) pane. */
function FitBounds({ houses }: { houses: MapHouse[] }) {
  const map = useMap();
  const key = houses.map((h) => `${h.houseId}:${h.lat}:${h.lng}`).join("|");

  useEffect(() => {
    if (!map) return;
    const fit = () => {
      if (houses.length === 0) {
        map.setCenter(SEOUL);
        map.setZoom(11);
      } else if (houses.length === 1) {
        map.setCenter({ lat: houses[0].lat, lng: houses[0].lng });
        map.setZoom(15);
      } else {
        const bounds = new google.maps.LatLngBounds();
        for (const h of houses) bounds.extend({ lat: h.lat, lng: h.lng });
        map.fitBounds(bounds, 48);
      }
    };
    fit();

    const el = map.getDiv();
    let sized = el.clientWidth > 0;
    const observer = new ResizeObserver(() => {
      if (!sized && el.clientWidth > 0) {
        sized = true;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // `key` captures the marker set; `houses` itself is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

function HouseCard({ house, locale, stayQuery }: { house: MapHouse; locale: Locale; stayQuery: string }) {
  const t = useTranslations("search");
  return (
    <div className="w-56 text-sm">
      {house.photoUrl && (
        <Image
          src={house.photoUrl}
          alt=""
          width={224}
          height={112}
          sizes="224px"
          className="mb-2 h-28 w-full rounded object-cover"
        />
      )}
      <p className="font-semibold text-zinc-900">{house.name}</p>
      <p className="text-xs text-zinc-500">
        {house.district} · {t("roomsInHouse", { count: house.roomCount })}
      </p>
      <p className="mt-1 text-zinc-900">
        {t("fromPrice", { price: formatKRW(house.minRent) })}{" "}
        <span className="text-xs text-zinc-500">{formatUsdReference(house.minRent)}</span>
      </p>
      <Link
        href={`/houses/${house.houseId}${stayQuery}`}
        locale={locale}
        className="mt-2 inline-block font-medium text-blue-700 underline"
      >
        {t("viewHouse")}
      </Link>
    </div>
  );
}

/**
 * Google map of the results: one marker per house (cheapest rent as label), a click opens the house card.
 * Without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY only the fallback notice is rendered. `stayQuery` is the
 * `?moveIn=…&lastNight=…` string (or empty) that keeps the searched stay on the house link.
 */
export function ResultsMap({ houses, stayQuery }: { houses: MapHouse[]; stayQuery: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("search");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return <MapFallback />;

  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;
  const selected = houses.find((h) => h.houseId === selectedId) ?? null;

  return (
    <div role="region" aria-label={t("mapLabel")} className="h-full w-full overflow-hidden rounded-lg border border-zinc-200">
      <APIProvider apiKey={apiKey} language={locale}>
        <Map
          defaultCenter={SEOUL}
          defaultZoom={11}
          mapId={mapId}
          gestureHandling="cooperative"
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={false}
          onClick={() => setSelectedId(null)}
        >
          <FitBounds houses={houses} />
          {houses.map((h) =>
            mapId ? (
              <AdvancedMarker
                key={h.houseId}
                position={{ lat: h.lat, lng: h.lng }}
                title={h.name}
                zIndex={h.houseId === selectedId ? 10 : 1}
                onClick={() => setSelectedId(h.houseId)}
              >
                <span className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 shadow">
                  {compactKrw(h.minRent, locale)}
                </span>
              </AdvancedMarker>
            ) : (
              <Marker
                key={h.houseId}
                position={{ lat: h.lat, lng: h.lng }}
                title={h.name}
                label={{ text: compactKrw(h.minRent, locale), fontSize: "11px", fontWeight: "600" }}
                onClick={() => setSelectedId(h.houseId)}
              />
            ),
          )}
          {selected && (
            <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelectedId(null)}>
              <HouseCard house={selected} locale={locale} stayQuery={stayQuery} />
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
