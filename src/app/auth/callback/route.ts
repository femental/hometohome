import type { NextRequest } from "next/server";
import { finishSignIn, nextFromParam } from "@/server/auth/finish-sign-in";
import { createSupabaseServerClient } from "@/server/auth/supabase";

/** Google OAuth (PKCE) return: exchange the code, sync the user, go to `next` (see finishSignIn). */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = nextFromParam(request.nextUrl.searchParams.get("next"));

  const supabase = await createSupabaseServerClient();
  if (!code) return finishSignIn(supabase, null, next);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  return finishSignIn(supabase, error ? null : data.user, next);
}
