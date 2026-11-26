import { execSync } from "node:child_process";

/**
 * Environment for the E2E run against the local Supabase stack (`npm run sb:start`).
 * Keys come from the shell / `.env.local` when set, otherwise from `supabase status`.
 */
export const E2E_PORT = 3123;
export const APP_URL = `http://localhost:${E2E_PORT}`;
export const ADMIN_EMAIL = "e2e-admin@example.com";

let cached: Record<string, string> | null = null;

function supabaseStatus(): Record<string, string> {
  let out: string;
  try {
    out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    // The CLI exits non-zero when an optional service is stopped but still prints the values.
    out = String((e as { stdout?: string }).stdout ?? "");
  }
  return Object.fromEntries(
    out
      .split(/\r?\n/)
      .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

export function e2eEnv(): Record<string, string> {
  if (cached) return cached;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // optional
  }
  const needStatus = !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY;
  const status = needStatus ? supabaseStatus() : {};
  const databaseUrl = process.env.DATABASE_URL ?? status.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? status.API_URL ?? "http://127.0.0.1:54321";
  // The run creates users and uploads files: never against anything but the local stack.
  for (const u of [databaseUrl, supabaseUrl]) {
    const host = new URL(u).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`E2E runs only against local Supabase, not ${host}.`);
  }
  cached = {
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? status.ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY ?? "",
    APP_URL,
    ADMIN_EMAILS: ADMIN_EMAIL,
    EMAIL_FROM: "HomeToHome <onboarding@resend.dev>",
    PORTONE_FAKE: "1",
    NEXT_PUBLIC_USD_KRW_REFERENCE: "1380",
    FX_USD_KRW_FALLBACK: "1380",
    NEXT_PUBLIC_PHOTO_BUCKET: "photos",
  };
  return cached;
}
