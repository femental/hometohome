import "server-only";
import type { User } from "@/generated/prisma/client";
import type { Db } from "@/server/db";

export type SyncUserInput = {
  /** Supabase auth user id — also our `users.id`. */
  authId: string;
  email: string;
  name?: string | null;
  /** Lowercased admin email list (`serverEnv().ADMIN_EMAILS`). */
  adminEmails: string[];
};

/**
 * Upserts the app user for a Supabase auth user.
 *
 * - `role` is recomputed on every call, so removing an email from ADMIN_EMAILS demotes on next sync.
 * - `locale` is set only on create; an existing user's choice is never overwritten.
 * - `name` falls back to the email local-part on create; an existing name is only replaced by a
 *   non-empty provided name (a later magic-link login must not wipe the Google profile name).
 * - The stored email follows the auth user (same id) if it changed.
 */
export async function syncUser(db: Db, a: SyncUserInput): Promise<User> {
  const email = a.email.trim();
  const admins = new Set(a.adminEmails.map((e) => e.trim().toLowerCase()));
  const role = admins.has(email.toLowerCase()) ? "admin" : "guest";
  const providedName = a.name?.trim() || undefined;

  return db.user.upsert({
    where: { id: a.authId },
    create: {
      id: a.authId,
      email,
      name: providedName ?? email.split("@")[0],
      role,
      locale: "en",
    },
    update: { email, role, ...(providedName ? { name: providedName } : {}) },
  });
}
