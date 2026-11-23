import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { finishSignIn, nextFromParam } from "@/server/auth/finish-sign-in";
import { createSupabaseServerClient } from "@/server/auth/supabase";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup"];

function emailOtpType(value: string | null): EmailOtpType | null {
  return EMAIL_OTP_TYPES.find((t) => t === value) ?? null;
}

/**
 * Magic-link return (`supabase/templates/magic_link.html`). The link carries a `token_hash` instead
 * of a PKCE code, so it works when the email is opened in another browser (phone mail apps, in-app
 * browsers) than the one that asked for it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = emailOtpType(params.get("type"));
  const next = nextFromParam(params.get("next"));

  const supabase = await createSupabaseServerClient();
  if (!tokenHash || !type) return finishSignIn(supabase, null, next);

  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  return finishSignIn(supabase, error ? null : data.user, next);
}
