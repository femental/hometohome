import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

/** Paths that are not guest pages: the Korean admin, the legacy /login redirect, auth routes, APIs, files. */
const NON_LOCALIZED = /^\/(?:admin|login|auth|api)(?:\/|$)/;

function isLocalized(pathname: string): boolean {
  return !NON_LOCALIZED.test(pathname) && !pathname.includes(".");
}

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Refreshes the Supabase session cookies on the request and collects the ones to send back.
 * Without Supabase env (unit tests) it skips the refresh and reports an anonymous visitor.
 */
async function refreshSession(request: NextRequest) {
  const cookies: CookieToSet[] = [];
  const headers: Record<string, string> = {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { user: null, cookies, headers };

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, cacheHeaders) {
        // Updating the request cookies forwards the refreshed tokens to Server Components.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        cookies.push(...cookiesToSet);
        Object.assign(headers, cacheHeaders);
      },
    },
  });

  // Must run right after creating the client: it refreshes an expired session and rewrites cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, cookies, headers };
}

/**
 * 1. Refreshes the Supabase session (request cookies updated in place).
 * 2. Guest paths go through next-intl (locale prefix redirect / locale header); its response is built
 *    from the already-refreshed request. Other paths get a plain pass-through.
 * 3. The refreshed Supabase cookies and cache headers are applied to that same response.
 * Anonymous visitors of /admin are optimistically sent to /ko/login — `requireAdmin()` is the real check.
 * (No `server-only`/`serverEnv` here: Proxy runs outside the React server graph; only public
 * values are read.)
 */
export async function proxy(request: NextRequest) {
  const session = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  let response: NextResponse;
  if (isLocalized(pathname)) {
    response = handleI18nRouting(request);
  } else if (!session.user && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/ko/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request });
  }

  for (const { name, value, options } of session.cookies) response.cookies.set(name, value, options);
  for (const [key, value] of Object.entries(session.headers)) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
