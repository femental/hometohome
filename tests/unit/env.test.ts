import { expect, test } from "vitest";
import { parseAppUrl, parseBankTransferInfo, parseServerEnv } from "@/server/env";

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

test("optional keys may be absent", () => {
  const env = parseServerEnv(validEnv);
  expect(env.RESEND_API_KEY).toBeUndefined();
  expect(env.KAKAO_REST_API_KEY).toBeUndefined();
});

test("RESEND_API_KEY is required in production, optional in development", () => {
  expect(() => parseServerEnv({ ...validEnv, NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
  expect(() => parseServerEnv({ ...validEnv, NODE_ENV: "production", RESEND_API_KEY: "" })).toThrow(/RESEND_API_KEY/);
  expect(parseServerEnv({ ...validEnv, NODE_ENV: "production", RESEND_API_KEY: "re_x" }).RESEND_API_KEY).toBe("re_x");
  expect(() => parseServerEnv({ ...validEnv, NODE_ENV: "development" })).not.toThrow();
});

test("bank-transfer info is optional, multi-line, and blank means unset", () => {
  expect(parseBankTransferInfo({})).toEqual({});
  expect(parseBankTransferInfo({ BANK_TRANSFER_INFO_EN: "  ", BANK_TRANSFER_INFO_KO: "" })).toEqual({});
  expect(
    parseBankTransferInfo({
      BANK_TRANSFER_INFO_EN: "Bank: Shinhan\r\nAccount: 110-123\r\n",
      BANK_TRANSFER_INFO_KO: "신한은행 110-123",
    }),
  ).toEqual({ BANK_TRANSFER_INFO_EN: "Bank: Shinhan\nAccount: 110-123", BANK_TRANSFER_INFO_KO: "신한은행 110-123" });
  // Read on its own: no server secrets needed.
  expect(() => parseBankTransferInfo({ BANK_TRANSFER_INFO_EN: "x" })).not.toThrow();
  expect(parseServerEnv({ ...validEnv, BANK_TRANSFER_INFO_KO: "신한" }).BANK_TRANSFER_INFO_KO).toBe("신한");
});

test("parseAppUrl reads only APP_URL and omits missing or invalid values", () => {
  expect(parseAppUrl({ APP_URL: " https://hometohome.example " })?.origin).toBe("https://hometohome.example");
  expect(parseAppUrl({})).toBeUndefined();
  expect(parseAppUrl({ APP_URL: "not a url" })).toBeUndefined();
});
