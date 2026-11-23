import { expect, test } from "vitest";
import { parseServerEnv } from "@/server/env";

const validEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  APP_URL: "http://localhost:3000",
  ADMIN_EMAILS: "admin@example.com",
  EMAIL_FROM: "HomeToHome <no-reply@example.com>",
};

test("ADMIN_EMAILS is parsed, lowercased and trimmed", () => {
  expect(parseServerEnv({ ...validEnv, ADMIN_EMAILS: " Boss@Example.com, ops@example.com " }).ADMIN_EMAILS)
    .toEqual(["boss@example.com", "ops@example.com"]);
});

test("missing required key throws naming the key", () => {
  expect(() => parseServerEnv({ ...validEnv, APP_URL: undefined })).toThrow(/APP_URL/);
});

test("PHOTO_BUCKET defaults to photos and optional keys may be absent", () => {
  const env = parseServerEnv(validEnv);
  expect(env.PHOTO_BUCKET).toBe("photos");
  expect(env.RESEND_API_KEY).toBeUndefined();
  expect(env.KAKAO_REST_API_KEY).toBeUndefined();
});
