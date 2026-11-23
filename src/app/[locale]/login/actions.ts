"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { routing, type Locale } from "@/i18n/routing";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { safeNext } from "@/server/auth/session";

// Sign-in itself needs no session, so these actions do not call requireUser().

const localeSchema = z.enum(routing.locales).catch(routing.defaultLocale);
const emailSchema = z.string().trim().pipe(z.email());

function readForm(formData: FormData): { locale: Locale; next: string } {
  const locale = localeSchema.parse(formData.get("locale"));
  const raw = formData.get("next");
  const next = typeof raw === "string" && raw ? safeNext(raw) : `/${locale}`;
  return { locale, next };
}

function loginUrl(locale: Locale, params: Record<string, string>, next: string): string {
  const search = new URLSearchParams(params);
  if (next !== `/${locale}`) search.set("next", next);
  return `/${locale}/login?${search}`;
}

/**
 * Magic link. The email template (supabase/templates/magic_link.html) builds the link to
 * /auth/confirm?token_hash=… and passes this redirect URL (absolute `next`) along as `next`.
 */
export async function sendMagicLink(formData: FormData): Promise<void> {
  const { locale, next } = readForm(formData);
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) redirect(loginUrl(locale, { error: "email" }, next));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: new URL(next, serverEnv().APP_URL).href },
  });
  if (error) console.error("sign-in: magic link not sent", error.message);
  redirect(loginUrl(locale, error ? { error: "send" } : { sent: "1" }, next));
}

/** Google OAuth (PKCE: same browser) returns to /auth/callback. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const { locale, next } = readForm(formData);
  const callback = new URL("/auth/callback", serverEnv().APP_URL);
  callback.searchParams.set("next", next);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.href },
  });
  if (error || !data.url) redirect(loginUrl(locale, { error: "oauth" }, next));
  redirect(data.url);
}
