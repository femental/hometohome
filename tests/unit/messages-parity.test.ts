import { expect, test } from "vitest";
import en from "../../messages/en.json";
import ko from "../../messages/ko.json";

/** Every leaf key path, e.g. `nav.search`. */
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([key, value]) => keyPaths(value, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function leaves(obj: unknown): unknown[] {
  return obj !== null && typeof obj === "object" ? Object.values(obj).flatMap(leaves) : [obj];
}

test("en and ko message files have identical key sets", () => {
  expect(keyPaths(ko)).toEqual(keyPaths(en));
});

test("every message is a non-empty string", () => {
  for (const value of [...leaves(en), ...leaves(ko)]) {
    expect(typeof value === "string" && value.trim().length > 0).toBe(true);
  }
});
