import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { prisma } from "@/server/db";
import { serverEnv } from "@/server/env";
import { localeFromPath } from "./guest";
import { safeNext, toAuthUser } from "./session";
import { syncUser } from "./sync-user";

/**
 * The `next` query param of a sign-in link. The magic-link email template passes Supabase's
 * `RedirectTo`, an absolute URL — same-origin ones become their path; anything else goes through
 * `safeNext` (so other origins and `//host` become "/").
 */
export function nextFromParam(raw: string | null): string {
  if (raw && URL.canParse(raw)) {
    const url = new URL(raw);
    if (url.origin === new URL(serverEnv().APP_URL).origin) return safeNext(url.pathname + url.search + url.hash);
  }
  return safeNext(raw);
}

/**
 * Last step of both sign-in routes. With a verified user: sync the `users` row (the only place
 * guests are synced) and go to `next`. Without one, or if the sync throws: sign out (drop any
 * half-made session) and go to `/{locale}/login?error=auth`, locale taken from `next` (ko for /admin).
 */
export async function finishSignIn(supabase: SupabaseClient, user: User | null, next: string): Promise<NextResponse> {
  const env = serverEnv();
  const authUser = user ? toAuthUser(user) : null;
  if (authUser) {
    try {
      await syncUser(prisma, {
        authId: authUser.id,
        email: authUser.email,
        name: authUser.name,
        adminEmails: env.ADMIN_EMAILS,
      });
      return NextResponse.redirect(new URL(next, env.APP_URL));
    } catch (e) {
      console.error("sign-in: user sync failed", e);
    }
  }

  // Local scope clears the session cookies before any network call; the default global scope
  // revokes first and keeps the cookies if that request fails (e.g. the DB is down).
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) console.error("sign-in: sign-out after failure returned an error", signOutError.message);
  // The admin is Korean-only, so a failed admin sign-in goes back to the Korean login page.
  const locale = /^\/admin(?:[/?#]|$)/.test(next) ? "ko" : localeFromPath(next);
  const failed = new URL(`/${locale}/login`, env.APP_URL);
  failed.searchParams.set("error", "auth");
  if (next !== "/") failed.searchParams.set("next", next);
  return NextResponse.redirect(failed);
}
