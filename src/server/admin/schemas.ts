import { z } from "zod";
import { AMENITIES, DISTRICTS } from "@/domain/amenities";
import { isValidISODate } from "@/domain/dates";

const isoDate = z
  .string()
  .refine((s) => isValidISODate(s), "올바른 날짜(YYYY-MM-DD)를 입력해 주세요.");

const i18n = z.object({
  en: z.string().trim().min(1, "영문 값을 입력해 주세요."),
  ko: z.string().trim().optional(),
});

const intAmount = (min: number, label: string) =>
  z
    .number({ error: `${label}을(를) 숫자로 입력해 주세요.` })
    .int(`${label}은(는) 정수여야 합니다.`)
    .min(min, `${label}은(는) ${min.toLocaleString("ko-KR")} 이상이어야 합니다.`);

const station = z.object({
  name_en: z.string().trim().min(1, "역 이름(영문)을 입력해 주세요."),
  name_ko: z.string().trim().min(1, "역 이름(한글)을 입력해 주세요."),
  line: z.string().trim().min(1, "노선을 입력해 주세요."),
  walk_min: intAmount(0, "도보 시간"),
});

export const houseInput = z.object({
  name: i18n,
  description: i18n,
  houseRules: i18n,
  addressKo: z.string().trim().min(1, "한글 주소를 입력해 주세요."),
  addressEn: z.string().trim().optional(),
  district: z.enum(DISTRICTS.map((d) => d.code) as [string, ...string[]], {
    error: "지역(구)을 선택해 주세요.",
  }),
  lat: z
    .number({ error: "위도를 숫자로 입력해 주세요." })
    .min(33, "위도는 33~39 범위여야 합니다.")
    .max(39, "위도는 33~39 범위여야 합니다."),
  lng: z
    .number({ error: "경도를 숫자로 입력해 주세요." })
    .min(124, "경도는 124~132 범위여야 합니다.")
    .max(132, "경도는 124~132 범위여야 합니다."),
  nearestStations: z.array(station).max(5, "가까운 역은 최대 5개까지입니다."),
  amenities: z.array(z.enum(AMENITIES, { error: "알 수 없는 편의시설입니다." })),
});
export type HouseInput = z.infer<typeof houseInput>;

export const roomInput = z
  .object({
    name: i18n,
    description: i18n,
    monthlyRent: intAmount(1, "월세"),
    deposit: intAmount(0, "보증금"),
    availableFrom: isoDate,
    roomType: z.enum(["single", "double"], { error: "방 유형을 선택해 주세요." }),
    privateBathroom: z.boolean(),
    genderPolicy: z.enum(["male", "female", "any"], { error: "성별 정책을 선택해 주세요." }),
    extraPersonMonthlyFee: intAmount(0, "추가 인원 월 요금").default(0),
  })
  // maxOccupants and the extra fee follow from roomType; submitted values are ignored.
  .transform((v) => ({
    ...v,
    maxOccupants: v.roomType === "single" ? 1 : 2,
    extraPersonMonthlyFee: v.roomType === "single" ? 0 : v.extraPersonMonthlyFee,
  }));
export type RoomInput = z.infer<typeof roomInput>;

export const blockInput = z
  .object({
    startDate: isoDate,
    endDateExclusive: isoDate,
    reason: z.string().trim().min(1, "사유를 입력해 주세요."),
  })
  .refine((v) => v.endDateExclusive > v.startDate, {
    path: ["endDateExclusive"],
    message: "종료일은 시작일보다 늦어야 합니다.",
  });
export type BlockInput = z.infer<typeof blockInput>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

function run<S extends z.ZodType>(schema: S, raw: unknown): ParseResult<z.output<S>> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_form";
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/** Blank -> undefined so required-number checks fire instead of coercing "" to 0. */
const num = (fd: FormData, key: string): number | undefined => {
  const s = str(fd, key);
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
};

const bool = (fd: FormData, key: string): boolean => {
  const v = str(fd, key);
  return v === "on" || v === "true" || v === "1";
};

/** `<key>.en` / `<key>.ko`; blank ko is dropped. */
function i18nField(fd: FormData, key: string) {
  const ko = str(fd, `${key}.ko`);
  return { en: str(fd, `${key}.en`), ...(ko ? { ko } : {}) };
}

/**
 * Stations use indexed fields: `stations[0].name_en`, `.name_ko`, `.line`, `.walk_min`.
 * Rows whose four fields are all blank are skipped.
 */
function stationsField(fd: FormData) {
  const indexes = new Set<number>();
  for (const key of fd.keys()) {
    const m = /^stations\[(\d+)\]\./.exec(key);
    if (m) indexes.add(Number(m[1]));
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .map((i) => ({
      name_en: str(fd, `stations[${i}].name_en`),
      name_ko: str(fd, `stations[${i}].name_ko`),
      line: str(fd, `stations[${i}].line`),
      walk_min: num(fd, `stations[${i}].walk_min`),
    }))
    .filter((s) => s.name_en || s.name_ko || s.line || s.walk_min !== undefined);
}

/** i18n fields: `name.en`, `name.ko`. Amenities: repeated `amenities` entries. Stations: see stationsField. */
export function parseHouseForm(fd: FormData): ParseResult<HouseInput> {
  return run(houseInput, {
    name: i18nField(fd, "name"),
    description: i18nField(fd, "description"),
    houseRules: i18nField(fd, "houseRules"),
    addressKo: str(fd, "addressKo"),
    addressEn: str(fd, "addressEn") || undefined,
    district: str(fd, "district"),
    lat: num(fd, "lat"),
    lng: num(fd, "lng"),
    nearestStations: stationsField(fd),
    amenities: fd.getAll("amenities").filter((v): v is string => typeof v === "string"),
  });
}

export function parseRoomForm(fd: FormData): ParseResult<RoomInput> {
  return run(roomInput, {
    name: i18nField(fd, "name"),
    description: i18nField(fd, "description"),
    monthlyRent: num(fd, "monthlyRent"),
    deposit: num(fd, "deposit"),
    availableFrom: str(fd, "availableFrom"),
    roomType: str(fd, "roomType"),
    privateBathroom: bool(fd, "privateBathroom"),
    genderPolicy: str(fd, "genderPolicy"),
    extraPersonMonthlyFee: num(fd, "extraPersonMonthlyFee"),
  });
}

export function parseBlockForm(fd: FormData): ParseResult<BlockInput> {
  return run(blockInput, {
    startDate: str(fd, "startDate"),
    endDateExclusive: str(fd, "endDateExclusive"),
    reason: str(fd, "reason"),
  });
}
