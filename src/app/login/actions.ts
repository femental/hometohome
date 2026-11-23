"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { safeNext } from "@/server/auth/session";

/** Never fails: anything that is not a safe relative path becomes "/". */
const nextSchema = z.preprocess((v) => (typeof v === "string" ? v : null), z.string().nullable().transform(safeNext));
const emailSchema = z.string().trim().pipe(z.email());

function loginUrl(params: Record<string, string>, next: string): string {
  const search = new URLSearchParams(params);
  if (next !== "/") search.set("next", next);
  return `/login?${search}`;
}

function callbackUrl(next: string): string {
  const url = new URL("/auth/callback", serverEnv().APP_URL);
  url.searchParams.set("next", next);
  return url.href;
}

export async function sendMagicLink(formData: FormData): Promise<void> {
  const next = nextSchema.parse(formData.get("next"));
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) redirect(loginUrl({ error: "email" }, next));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: callbackUrl(next) },
  });
  redirect(loginUrl(error ? { error: "send" } : { sent: "1" }, next));
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = nextSchema.parse(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(next) },
  });
  if (error || !data.url) redirect(loginUrl({ error: "oauth" }, next));
  redirect(data.url);
}
