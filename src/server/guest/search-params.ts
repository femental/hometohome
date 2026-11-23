import { DISTRICTS } from "@/domain/amenities";
import { addDays, isValidISODate, type ISODate } from "@/domain/dates";
import type { RoomSearchParams } from "@/server/rooms/search";

export type SearchIssue =
  | "dates_incomplete"
  | "dates_order"
  | "dates_past"
  | "rent_invalid"
  | "district_invalid";

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Earliest move-in offered for a date search: today (KST) + this many days. */
const MIN_LEAD_DAYS = 3;
const DISTRICT_CODES = new Set(DISTRICTS.map((d) => d.code));

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function many(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((s) => s.trim()).filter(Boolean);
}

const toRent = (s: string): number | null => (/^\d{1,9}$/.test(s) ? Number(s) : null);

/**
 * URL query → search filters. Never throws: a bad filter is dropped and reported as an issue so the
 * page can still show results (and tell the guest which input was ignored).
 */
export function parseSearchParams(
  sp: RawSearchParams,
  todayKst: ISODate,
): { params: RoomSearchParams; issues: SearchIssue[] } {
  const params: RoomSearchParams = {};
  const issues: SearchIssue[] = [];

  const moveIn = first(sp.moveIn);
  const lastNight = first(sp.lastNight);
  if (moveIn || lastNight) {
    if (!isValidISODate(moveIn) || !isValidISODate(lastNight)) {
      issues.push("dates_incomplete");
    } else if (lastNight < moveIn) {
      issues.push("dates_order");
    } else if (moveIn < addDays(todayKst, MIN_LEAD_DAYS)) {
      issues.push("dates_past");
    } else {
      params.moveIn = moveIn;
      params.lastNight = lastNight;
    }
  }

  const minRaw = first(sp.minRent);
  const maxRaw = first(sp.maxRent);
  const min = minRaw ? toRent(minRaw) : undefined;
  const max = maxRaw ? toRent(maxRaw) : undefined;
  if (min === null || max === null) {
    // A malformed end drops only itself.
    issues.push("rent_invalid");
    if (typeof min === "number") params.minRent = min;
    if (typeof max === "number") params.maxRent = max;
  } else if (min !== undefined && max !== undefined && min > max) {
    // A reversed range drops both ends.
    issues.push("rent_invalid");
  } else {
    if (min !== undefined) params.minRent = min;
    if (max !== undefined) params.maxRent = max;
  }

  const districts = [...new Set(many(sp.district))];
  const validDistricts = districts.filter((d) => DISTRICT_CODES.has(d));
  if (validDistricts.length < districts.length) issues.push("district_invalid");
  if (validDistricts.length > 0) params.districts = validDistricts;

  const type = first(sp.type);
  if (type === "single" || type === "double") params.roomType = type;
  const gender = first(sp.gender);
  if (gender === "male" || gender === "female" || gender === "any") params.genderPolicy = gender;
  const occupants = first(sp.occupants);
  if (occupants === "1") params.occupants = 1;
  else if (occupants === "2") params.occupants = 2;

  return { params, issues };
}
