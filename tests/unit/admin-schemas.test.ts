import { describe, expect, test } from "vitest";
import { DISTRICTS, districtCodeFromSigungu } from "@/domain/amenities";
import { houseInput, parseBlockForm, parseHouseForm, parseRoomForm, roomInput } from "@/server/admin/schemas";

const house = {
  name: { en: "Mapo House" },
  description: { en: "Nice" },
  houseRules: { en: "Quiet" },
  addressKo: "서울 마포구 와우산로 1",
  district: "mapo",
  lat: 37.55,
  lng: 126.92,
  nearestStations: [],
  amenities: ["wifi"],
};
const room = {
  name: { en: "101" },
  description: { en: "Cozy" },
  monthlyRent: 800_000,
  deposit: 500_000,
  availableFrom: "2027-01-01",
  roomType: "single",
  privateBathroom: false,
  genderPolicy: "any",
  extraPersonMonthlyFee: 100_000,
};

describe("houseInput", () => {
  test("accepts a valid house", () => {
    expect(houseInput.safeParse(house).success).toBe(true);
  });
  test("rejects missing en name and out-of-Korea coordinates", () => {
    expect(houseInput.safeParse({ ...house, name: { en: "", ko: "집" } }).success).toBe(false);
    expect(houseInput.safeParse({ ...house, lat: 40 }).success).toBe(false);
    expect(houseInput.safeParse({ ...house, lng: 100 }).success).toBe(false);
  });
  test("rejects unknown district, unknown amenity and more than 5 stations", () => {
    expect(houseInput.safeParse({ ...house, district: "atlantis" }).success).toBe(false);
    expect(houseInput.safeParse({ ...house, amenities: ["pool"] }).success).toBe(false);
    const st = { name_en: "A", name_ko: "에이", line: "2", walk_min: 3 };
    expect(houseInput.safeParse({ ...house, nearestStations: Array(6).fill(st) }).success).toBe(false);
    expect(houseInput.safeParse({ ...house, nearestStations: Array(5).fill(st) }).success).toBe(true);
  });
});

describe("roomInput", () => {
  test("derives maxOccupants from roomType and zeroes extra fee for single", () => {
    const s = roomInput.parse(room);
    expect(s.maxOccupants).toBe(1);
    expect(s.extraPersonMonthlyFee).toBe(0);
    const d = roomInput.parse({ ...room, roomType: "double" });
    expect(d.maxOccupants).toBe(2);
    expect(d.extraPersonMonthlyFee).toBe(100_000);
  });
  test("rejects non-positive rent, negative deposit, fractions and bad dates", () => {
    expect(roomInput.safeParse({ ...room, monthlyRent: 0 }).success).toBe(false);
    expect(roomInput.safeParse({ ...room, deposit: -1 }).success).toBe(false);
    expect(roomInput.safeParse({ ...room, monthlyRent: 1000.5 }).success).toBe(false);
    expect(roomInput.safeParse({ ...room, availableFrom: "2027-02-30" }).success).toBe(false);
  });
});

describe("form parsing", () => {
  test("parseHouseForm reads i18n, amenities and indexed stations", () => {
    const fd = new FormData();
    fd.set("name.en", "Mapo House");
    fd.set("name.ko", "");
    fd.set("description.en", "Nice");
    fd.set("houseRules.en", "Quiet");
    fd.set("addressKo", "서울 마포구");
    fd.set("district", "mapo");
    fd.set("lat", "37.5");
    fd.set("lng", "126.9");
    fd.append("amenities", "wifi");
    fd.append("amenities", "tv");
    fd.set("stations[0].name_en", "Hongik");
    fd.set("stations[0].name_ko", "홍대입구");
    fd.set("stations[0].line", "2");
    fd.set("stations[0].walk_min", "5");
    fd.set("stations[1].name_en", "");
    const r = parseHouseForm(fd);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toEqual({ en: "Mapo House" });
      expect(r.data.amenities).toEqual(["wifi", "tv"]);
      expect(r.data.nearestStations).toEqual([{ name_en: "Hongik", name_ko: "홍대입구", line: "2", walk_min: 5 }]);
    }
  });
  test("parseHouseForm returns Korean errors keyed by field path", () => {
    const r = parseHouseForm(new FormData());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors["name.en"]).toMatch(/영문/);
      expect(r.errors.lat).toBeDefined();
    }
  });
  test("parseRoomForm handles checkbox and number fields", () => {
    const fd = new FormData();
    fd.set("name.en", "101");
    fd.set("description.en", "Cozy");
    fd.set("monthlyRent", "800000");
    fd.set("deposit", "0");
    fd.set("availableFrom", "2027-01-01");
    fd.set("roomType", "double");
    fd.set("privateBathroom", "on");
    fd.set("genderPolicy", "any");
    fd.set("extraPersonMonthlyFee", "150000");
    const r = parseRoomForm(fd);
    expect(r.ok && r.data.privateBathroom && r.data.maxOccupants === 2).toBe(true);
  });
  test("parseBlockForm rejects end <= start", () => {
    const fd = new FormData();
    fd.set("startDate", "2027-02-10");
    fd.set("endDateExclusive", "2027-02-10");
    fd.set("reason", "repair");
    const r = parseBlockForm(fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.endDateExclusive).toBeDefined();
  });
});

describe("districts", () => {
  test("has 25 unique codes", () => {
    expect(DISTRICTS).toHaveLength(25);
    expect(new Set(DISTRICTS.map((d) => d.code)).size).toBe(25);
  });
  test("districtCodeFromSigungu accepts Korean and English forms", () => {
    expect(districtCodeFromSigungu("마포구")).toBe("mapo");
    expect(districtCodeFromSigungu("서울 마포구")).toBe("mapo");
    expect(districtCodeFromSigungu("서울특별시 마포구")).toBe("mapo");
    expect(districtCodeFromSigungu("Mapo-gu")).toBe("mapo");
    expect(districtCodeFromSigungu("MAPO")).toBe("mapo");
    expect(districtCodeFromSigungu("Jung-gu")).toBe("jung");
    expect(districtCodeFromSigungu("중구")).toBe("jung");
    expect(districtCodeFromSigungu("수원시")).toBeNull();
    expect(districtCodeFromSigungu("")).toBeNull();
  });
});

describe("amount and text bounds", () => {
  test("amounts above 100,000,000 are rejected, the bound itself is accepted", () => {
    const over = roomInput.safeParse({ ...room, monthlyRent: 100_000_001 });
    expect(over.success).toBe(false);
    if (!over.success) expect(over.error.issues[0].message).toBe("1억 원 이하로 입력해 주세요.");
    expect(roomInput.safeParse({ ...room, deposit: 100_000_000 }).success).toBe(true);
  });

  test("name and description lengths are capped", () => {
    expect(houseInput.safeParse({ ...house, name: { en: "a".repeat(101) } }).success).toBe(false);
    expect(houseInput.safeParse({ ...house, description: { en: "a".repeat(5001) } }).success).toBe(false);
    expect(houseInput.safeParse({ ...house, houseRules: { en: "a".repeat(5000) } }).success).toBe(true);
  });
});
