import type { Locale } from "@/i18n/routing";
import { pickText } from "@/lib/i18n-text";
import type { RoomSearchResult } from "@/server/rooms/search";

/** One map marker: all matching rooms of a house, labelled with the cheapest rent. */
export interface MapHouse {
  houseId: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  minRent: number;
  roomCount: number;
  photoUrl: string | null;
}

/** Groups search results by house (input is cheapest-first, so the first room is the cover). */
export function groupByHouse(
  rooms: RoomSearchResult[],
  locale: Locale,
  districtLabel: (code: string) => string,
  photo: (path: string) => string,
): MapHouse[] {
  const byHouse = new Map<string, MapHouse>();
  for (const r of rooms) {
    const existing = byHouse.get(r.houseId);
    if (existing) {
      existing.roomCount += 1;
      existing.minRent = Math.min(existing.minRent, r.monthlyRent);
      existing.photoUrl ??= r.coverPhotoPath ? photo(r.coverPhotoPath) : null;
      continue;
    }
    byHouse.set(r.houseId, {
      houseId: r.houseId,
      name: pickText(r.houseName, locale),
      district: districtLabel(r.district),
      lat: r.lat,
      lng: r.lng,
      minRent: r.monthlyRent,
      roomCount: 1,
      photoUrl: r.coverPhotoPath ? photo(r.coverPhotoPath) : null,
    });
  }
  return [...byHouse.values()];
}

/** Short rent for a marker: en `₩1.3M`, ko `130만`. */
export function compactKrw(krw: number, locale: Locale): string {
  if (locale === "ko") return `${Math.round(krw / 10_000).toLocaleString("en-US")}만`;
  return `₩${(Math.round(krw / 100_000) / 10).toFixed(1)}M`;
}
