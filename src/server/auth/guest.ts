import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { routing, type Locale } from "@/i18n/routing";
import { prisma } from "@/server/db";
import { serverEnv } from "@/server/env";
import { getAuthUser, loginPath, safeNext, type SessionUser } from "./session";
import { syncUser } from "./sync-user";

export type GuestUser = SessionUser & { name: string; locale: Locale };

function toLocale(value: string | undefined): Locale {
  return routing.locales.find((l) => l === value) ?? routing.defaultLocale;
}

/** Locale of a guest path (`/ko/bookings` → ko); anything else (`/`, `/admin`, null) → en. */
export function localeFromPath(path: string | null | undefined): Locale {
  return toLocale(safeNext(path).split(/[/?#]/)[1]);
}

/**
 * Current signed-in guest for guest pages, or null. Only **reads** the `users` row: the sign-in
 * routes (/auth/confirm, /auth/callback) already synced it. The row is created (one `syncUser`)
 * only if it is missing — e.g. a session from before the user table existed. Role is the stored one,
 * not recomputed: admin access goes through `requireAdmin()`. Deduped per request.
 */
export const getGuestUser = cache(async (): Promise<GuestUser | null> => {
  const authUser = await getAuthUser();
  if (!authUser) return null;
  const row =
    (await prisma.user.findUnique({ where: { id: authUser.id } })) ??
    (await syncUser(prisma, {
      authId: authUser.id,
      email: authUser.email,
      name: authUser.name,
      adminEmails: serverEnv().ADMIN_EMAILS,
    }));
  return { id: row.id, email: row.email, role: row.role, name: row.name, locale: toLocale(row.locale) };
});

/**
 * Guest pages and Server Actions: signed-in guest, or redirect to `/{locale}/login?next=…`
 * (locale taken from `next`, default en).
 */
export async function requireUser(next?: string): Promise<GuestUser> {
  const user = await getGuestUser();
  if (!user) redirect(loginPath(localeFromPath(next), next));
  return user;
}
