import "server-only";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Business registration details shown in the public footer (all optional; empty = hidden). */
const businessShape = {
  BUSINESS_NAME: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  BUSINESS_REP: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  BUSINESS_REG_NO: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  MAIL_ORDER_NO: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  BUSINESS_ADDRESS: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  BUSINESS_PHONE: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
  BUSINESS_EMAIL: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
};
const businessSchema = z.object(businessShape);

/** Normalizes line endings and trims; blank → unset. */
const multiline = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() || undefined : v),
  z.string().min(1).optional(),
);

/** Bank-transfer instructions on the guest payment page, per locale (multi-line; empty = not set). */
const bankTransferShape = {
  BANK_TRANSFER_INFO_EN: multiline,
  BANK_TRANSFER_INFO_KO: multiline,
};
const bankTransferSchema = z.object(bankTransferShape);

const schema = z.object({
  ...businessShape,
  ...bankTransferShape,
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_URL: z.string().url(),
  ADMIN_EMAILS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  EMAIL_FROM: z.string().min(1),
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  KAKAO_REST_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  PHOTO_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1).default("photos")),
});

export type ServerEnv = z.output<typeof schema>;

/** Pure validator (testable): throws an Error naming every invalid key. */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(raw);
  if (result.success && raw.NODE_ENV === "production" && !result.data.RESEND_API_KEY) {
    throw new Error("Invalid environment variables: RESEND_API_KEY: required in production");
  }
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${detail}`);
  }
  return result.data;
}

export type BusinessInfo = z.output<typeof businessSchema>;

/** Only the public business keys: the footer must not depend on (or validate) unrelated secrets. */
export function parseBusinessInfo(raw: Record<string, string | undefined>): BusinessInfo {
  return businessSchema.parse(raw);
}

export function businessInfo(): BusinessInfo {
  return parseBusinessInfo(process.env);
}

export type BankTransferInfo = z.output<typeof bankTransferSchema>;

/** Only the bank-transfer keys, so the payment page does not depend on (or validate) unrelated secrets. */
export function parseBankTransferInfo(raw: Record<string, string | undefined>): BankTransferInfo {
  return bankTransferSchema.parse(raw);
}

export function bankTransferInfo(): BankTransferInfo {
  return parseBankTransferInfo(process.env);
}

/** Only APP_URL, so public pages can set `metadataBase` without validating unrelated secrets. */
export function parseAppUrl(raw: Record<string, string | undefined>): URL | undefined {
  const parsed = z.string().url().safeParse(raw.APP_URL?.trim());
  return parsed.success ? new URL(parsed.data) : undefined;
}

let appUrlWarned = false;

/** `APP_URL` as a URL, or undefined (logged once) when missing/invalid. */
export function appUrl(): URL | undefined {
  const url = parseAppUrl(process.env);
  if (!url && !appUrlWarned) {
    appUrlWarned = true;
    console.warn("APP_URL is missing or invalid; metadataBase is not set");
  }
  return url;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
