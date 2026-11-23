import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { safeNext, toAuthUser } from "@/server/auth/session";
import { syncUser } from "@/server/auth/sync-user";

/** Magic-link / OAuth (PKCE) return: exchange the code, sync the user, go to `next`. */
export async function GET(request: NextRequest) {
  const env = serverEnv();
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const authUser = !error && data.user ? toAuthUser(data.user) : null;
    if (authUser) {
      await syncUser(prisma, {
        authId: authUser.id,
        email: authUser.email,
        name: authUser.name,
        adminEmails: env.ADMIN_EMAILS,
      });
      return NextResponse.redirect(new URL(next, env.APP_URL));
    }
  }

  const failed = new URL("/login", env.APP_URL);
  failed.searchParams.set("error", "auth");
  if (next !== "/") failed.searchParams.set("next", next);
  return NextResponse.redirect(failed);
}
