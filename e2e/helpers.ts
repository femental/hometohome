import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { APP_URL, e2eEnv } from "./env";

export function seed(): { houseId: string; roomId: string } {
  return JSON.parse(readFileSync("e2e/.seed.json", "utf8"));
}

/**
 * Signs `page` in as `email` through the real /auth/confirm route. The link is generated with the
 * admin API instead of being read from Mailpit: local Supabase sends only a couple of e-mails per
 * hour, which repeated runs would exhaust.
 */
export async function signIn(page: Page, email: string, next: string): Promise<void> {
  const env = e2eEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const url = new URL("/auth/confirm", APP_URL);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "email");
  url.searchParams.set("next", new URL(next, APP_URL).href);
  await page.goto(url.href);
}

/** ISO date `days` from today in Seoul. */
export function kstDate(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + days * 86400_000);
  return d.toISOString().slice(0, 10);
}
