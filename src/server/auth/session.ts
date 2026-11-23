import "server-only";
import { forbidden, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { prisma } from "@/server/db";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "./supabase";
import { syncUser } from "./sync-user";

export type SessionUser = { id: string; email: string; role: "guest" | "admin" };

export type AuthUser = { id: string; email: string; name?: string };

/** Maps a verified Supabase user to the fields we sync. Returns null if it has no email. */
export function toAuthUser(user: SupabaseUser): AuthUser | null {
  if (!user.email) return null;
  const meta = user.user_metadata ?? {};
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : undefined;
  return { id: user.id, email: user.email, name };
}

async function resolveFromSupabase(): Promise<AuthUser | null> {
  // Request time only: the auth check (token expiry vs. Date.now()) and the user sync (a DB write)
  // must never run during a prerender or runtime prefetch (cacheComponents + partialPrefetching).
  await connection();
  const supabase = await createSupabaseServerClient();
  // getUser() verifies the token with the Auth server; never trust getSession() on the server.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return toAuthUser(data.user);
}

let resolveAuthUser: () => Promise<AuthUser | null> = resolveFromSupabase;

/** Test hook: swap the auth resolver. Pass null to restore the Supabase resolver. */
export function __setAuthResolverForTests(fn: (() => Promise<AuthUser | null>) | null): void {
  resolveAuthUser = fn ?? resolveFromSupabase;
}

/** The verified Supabase user (no DB access), or null. Request time only. */
export function getAuthUser(): Promise<AuthUser | null> {
  return resolveAuthUser();
}

/**
 * Current signed-in user, synced to `users` (role recomputed from ADMIN_EMAILS — a DB write) on every
 * call. Only for the admin boundary; guest pages use the read-only `getGuestUser()` (./guest.ts).
 * Deduped per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const authUser = await resolveAuthUser();
  if (!authUser) return null;
  const user = await syncUser(prisma, {
    authId: authUser.id,
    email: authUser.email,
    name: authUser.name,
    adminEmails: serverEnv().ADMIN_EMAILS,
  });
  return { id: user.id, email: user.email, role: user.role };
});

/**
 * Only same-origin relative paths: must start with a single "/", not "//" or "/\".
 * Control characters and backslashes are rejected too (browsers strip/normalize them into "//").
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}

/** The localized login page (`/{locale}/login`), returning to a safe `next` if given. */
export function loginPath(locale: string, next?: string): string {
  const base = `/${locale}/login`;
  return next ? `${base}?next=${encodeURIComponent(safeNext(next))}` : base;
}

/**
 * Security boundary for every admin page, Server Action and Route Handler.
 * Anonymous → redirect to /ko/login (the admin is Korean); signed-in non-admin → forbidden() (403).
 */
export async function requireAdmin(next?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(loginPath("ko", next));
  if (user.role !== "admin") forbidden();
  return user;
}
