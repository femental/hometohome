import { describe, expect, test } from "vitest";
import { parseSearchParams } from "@/server/guest/search-params";

const TODAY = "2027-03-01";

describe("parseSearchParams", () => {
  test("valid params pass through", () => {
    const { params, issues } = parseSearchParams(
      {
        moveIn: "2027-03-10",
        lastNight: "2027-04-09",
        minRent: "500000",
        maxRent: "1500000",
        district: ["mapo", "yongsan"],
        type: "single",
        gender: "female",
        occupants: "2",
      },
      TODAY,
    );
    expect(issues).toEqual([]);
    expect(params).toEqual({
      moveIn: "2027-03-10",
      lastNight: "2027-04-09",
      minRent: 500000,
      maxRent: 1500000,
      districts: ["mapo", "yongsan"],
      roomType: "single",
      genderPolicy: "female",
      occupants: 2,
    });
  });

  test("empty query gives empty params", () => {
    expect(parseSearchParams({}, TODAY)).toEqual({ params: {}, issues: [] });
  });

  test("blank form fields are not issues", () => {
    const r = parseSearchParams({ moveIn: "", lastNight: "", minRent: "", maxRent: "", type: "" }, TODAY);
    expect(r).toEqual({ params: {}, issues: [] });
  });

  test("only lastNight → dates_incomplete, no date filter", () => {
    const { params, issues } = parseSearchParams({ lastNight: "2027-04-09" }, TODAY);
    expect(issues).toEqual(["dates_incomplete"]);
    expect(params.moveIn).toBeUndefined();
    expect(params.lastNight).toBeUndefined();
  });

  test("lastNight < moveIn → dates_order", () => {
    const { params, issues } = parseSearchParams({ moveIn: "2027-04-09", lastNight: "2027-04-01" }, TODAY);
    expect(issues).toEqual(["dates_order"]);
    expect(params.moveIn).toBeUndefined();
  });

  test("moveIn earlier than today+3 → dates_past", () => {
    const { params, issues } = parseSearchParams({ moveIn: "2027-03-03", lastNight: "2027-04-02" }, TODAY);
    expect(issues).toEqual(["dates_past"]);
    expect(params.moveIn).toBeUndefined();
    expect(parseSearchParams({ moveIn: "2027-03-04", lastNight: "2027-04-02" }, TODAY).issues).toEqual([]);
  });

  test("minRent=abc → rent_invalid, ignored", () => {
    const { params, issues } = parseSearchParams({ minRent: "abc", maxRent: "900000" }, TODAY);
    expect(issues).toEqual(["rent_invalid"]);
    expect(params.minRent).toBeUndefined();
    expect(params.maxRent).toBe(900000);
  });

  test("minRent above maxRent → rent_invalid, both dropped", () => {
    const { params, issues } = parseSearchParams({ minRent: "900000", maxRent: "500000" }, TODAY);
    expect(issues).toEqual(["rent_invalid"]);
    expect(params.minRent).toBeUndefined();
    expect(params.maxRent).toBeUndefined();
  });

  test("unknown district dropped with district_invalid", () => {
    const { params, issues } = parseSearchParams({ district: ["mapo", "atlantis"] }, TODAY);
    expect(issues).toEqual(["district_invalid"]);
    expect(params.districts).toEqual(["mapo"]);
  });

  test("single district string is accepted; invalid enum values are ignored", () => {
    const { params } = parseSearchParams({ district: "mapo", type: "suite", gender: "x", occupants: "3" }, TODAY);
    expect(params).toEqual({ districts: ["mapo"] });
  });
});
