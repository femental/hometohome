import { describe, expect, test } from "vitest";
import { compactKrw, groupByHouse } from "@/lib/map-houses";
import type { RoomSearchResult } from "@/server/rooms/search";

function room(over: Partial<RoomSearchResult>): RoomSearchResult {
  return {
    roomId: "r1",
    houseId: "h1",
    roomName: { en: "Room A" },
    houseName: { en: "Maple House", ko: "메이플 하우스" },
    district: "mapo",
    lat: 37.55,
    lng: 126.92,
    monthlyRent: 900_000,
    deposit: 1_000_000,
    availableFrom: "2027-03-01",
    roomType: "single",
    genderPolicy: "any",
    privateBathroom: false,
    coverPhotoPath: null,
    ...over,
  };
}

describe("groupByHouse", () => {
  test("rooms of one house become one marker with the lowest rent", () => {
    const rooms = [
      room({ roomId: "r1", monthlyRent: 900_000 }),
      room({ roomId: "r2", monthlyRent: 700_000, coverPhotoPath: "h1/a.jpg" }),
      room({ roomId: "r3", houseId: "h2", lat: 37.5, lng: 127, monthlyRent: 1_200_000 }),
    ];
    const houses = groupByHouse(rooms, "ko", (c) => c.toUpperCase(), (p) => `/p/${p}`);
    expect(houses).toHaveLength(2);
    expect(houses[0]).toMatchObject({
      houseId: "h1",
      name: "메이플 하우스",
      district: "MAPO",
      minRent: 700_000,
      roomCount: 2,
      photoUrl: "/p/h1/a.jpg",
    });
    expect(houses[1]).toMatchObject({ houseId: "h2", roomCount: 1, minRent: 1_200_000 });
  });
});

describe("compactKrw", () => {
  test("formats per locale", () => {
    expect(compactKrw(1_300_000, "en")).toBe("₩1.3M");
    expect(compactKrw(1_300_000, "ko")).toBe("130만");
  });
});
