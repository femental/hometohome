import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/server/auth/session";

/** Legacy login URL: the login page now lives at /{locale}/login (Korean, for operators). */
export function GET(request: NextRequest) {
  const url = new URL("/ko/login", request.nextUrl.origin);
  const next = request.nextUrl.searchParams.get("next");
  if (next) url.searchParams.set("next", safeNext(next));
  return NextResponse.redirect(url);
}
