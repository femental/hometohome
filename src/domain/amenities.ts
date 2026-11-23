export const AMENITIES = [
  "kitchen",
  "washer",
  "dryer",
  "wifi",
  "aircon",
  "heating",
  "elevator",
  "parking",
  "desk",
  "tv",
] as const;

export type Amenity = (typeof AMENITIES)[number];

export const AMENITY_LABELS: Record<Amenity, { en: string; ko: string }> = {
  kitchen: { en: "Kitchen", ko: "주방" },
  washer: { en: "Washer", ko: "세탁기" },
  dryer: { en: "Dryer", ko: "건조기" },
  wifi: { en: "Wi-Fi", ko: "와이파이" },
  aircon: { en: "Air conditioning", ko: "에어컨" },
  heating: { en: "Heating", ko: "난방" },
  elevator: { en: "Elevator", ko: "엘리베이터" },
  parking: { en: "Parking", ko: "주차" },
  desk: { en: "Desk", ko: "책상" },
  tv: { en: "TV", ko: "TV" },
};

export type District = { code: string; en: string; ko: string };

/** Seoul's 25 gu. `code` is the lowercase romanization without the "-gu" suffix. */
export const DISTRICTS: readonly District[] = [
  { code: "jongno", en: "Jongno-gu", ko: "종로구" },
  { code: "jung", en: "Jung-gu", ko: "중구" },
  { code: "yongsan", en: "Yongsan-gu", ko: "용산구" },
  { code: "seongdong", en: "Seongdong-gu", ko: "성동구" },
  { code: "gwangjin", en: "Gwangjin-gu", ko: "광진구" },
  { code: "dongdaemun", en: "Dongdaemun-gu", ko: "동대문구" },
  { code: "jungnang", en: "Jungnang-gu", ko: "중랑구" },
  { code: "seongbuk", en: "Seongbuk-gu", ko: "성북구" },
  { code: "gangbuk", en: "Gangbuk-gu", ko: "강북구" },
  { code: "dobong", en: "Dobong-gu", ko: "도봉구" },
  { code: "nowon", en: "Nowon-gu", ko: "노원구" },
  { code: "eunpyeong", en: "Eunpyeong-gu", ko: "은평구" },
  { code: "seodaemun", en: "Seodaemun-gu", ko: "서대문구" },
  { code: "mapo", en: "Mapo-gu", ko: "마포구" },
  { code: "yangcheon", en: "Yangcheon-gu", ko: "양천구" },
  { code: "gangseo", en: "Gangseo-gu", ko: "강서구" },
  { code: "guro", en: "Guro-gu", ko: "구로구" },
  { code: "geumcheon", en: "Geumcheon-gu", ko: "금천구" },
  { code: "yeongdeungpo", en: "Yeongdeungpo-gu", ko: "영등포구" },
  { code: "dongjak", en: "Dongjak-gu", ko: "동작구" },
  { code: "gwanak", en: "Gwanak-gu", ko: "관악구" },
  { code: "seocho", en: "Seocho-gu", ko: "서초구" },
  { code: "gangnam", en: "Gangnam-gu", ko: "강남구" },
  { code: "songpa", en: "Songpa-gu", ko: "송파구" },
  { code: "gangdong", en: "Gangdong-gu", ko: "강동구" },
];

/**
 * Maps a sigungu string ("마포구", "서울 마포구", "서울특별시 마포구", "Mapo-gu", "Mapo")
 * to a DISTRICTS code, or null when it is not one of Seoul's 25 gu.
 */
export function districtCodeFromSigungu(s: string): string | null {
  const tokens = s.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  for (const token of tokens) {
    const bare = token.replace(/-gu$/, "");
    const hit = DISTRICTS.find((d) => d.ko === token || d.code === bare);
    if (hit) return hit.code;
  }
  return null;
}
