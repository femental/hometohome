import { describe, expect, test } from "vitest";
import { geocodeAddress } from "@/server/geo/kakao";
import { districtCodeFromSigungu } from "@/domain/amenities";

const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("geocodeAddress", () => {
  test("parses first document's x/y", async () => {
    const fake = ok({ documents: [{ x: "126.9019", y: "37.5559" }] });
    expect(await geocodeAddress("서울 마포구 양화로 45", { apiKey: "k", fetch: fake as typeof fetch })).toEqual({
      lat: 37.5559,
      lng: 126.9019,
    });
  });

  test("sends KakaoAK authorization header and encoded query", async () => {
    let url = "";
    let auth = "";
    const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(JSON.stringify({ documents: [] }));
    };
    await geocodeAddress("서울 마포구 양화로 45", { apiKey: "secret", fetch: fake as typeof fetch });
    expect(url).toBe(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent("서울 마포구 양화로 45")}`,
    );
    expect(auth).toBe("KakaoAK secret");
  });

  test("no key / empty documents / HTTP 500 / network error → null", async () => {
    const never = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    expect(await geocodeAddress("a", { fetch: never })).toBeNull();
    expect(await geocodeAddress("a", { apiKey: "k", fetch: ok({ documents: [] }) as typeof fetch })).toBeNull();
    expect(await geocodeAddress("a", { apiKey: "k", fetch: ok({}, 500) as typeof fetch })).toBeNull();
    expect(await geocodeAddress("a", { apiKey: "k", fetch: never })).toBeNull();
  });

  test("non-numeric coordinates → null", async () => {
    const fake = ok({ documents: [{ x: "abc", y: "" }] });
    expect(await geocodeAddress("a", { apiKey: "k", fetch: fake as typeof fetch })).toBeNull();
  });

  test("aborts after the timeout and returns null", async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await geocodeAddress("a", { apiKey: "k", fetch: hang, timeoutMs: 20 })).toBeNull();
  });
});

describe("district mapping for Daum postcode values", () => {
  test("마포구 / Mapo-gu → mapo", () => {
    expect(districtCodeFromSigungu("마포구")).toBe("mapo");
    expect(districtCodeFromSigungu("Mapo-gu")).toBe("mapo");
    expect(districtCodeFromSigungu("수원시")).toBeNull();
  });
});
