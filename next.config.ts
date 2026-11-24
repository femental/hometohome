import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// NEXT_PUBLIC_* values are inlined at build time: a production build without them cannot work.
function assertBuildEnv() {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter((k) => !process.env[k]);
  if (missing.length > 0) throw new Error(`Production build needs ${missing.join(", ")}.`);
}

/** Supabase Storage public photos are the only remote images (next/image). Derived from the project URL. */
function supabasePhotoPattern() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      protocol: u.protocol.replace(":", "") as "http" | "https",
      hostname: u.hostname,
      port: u.port,
      pathname: "/storage/v1/object/public/**",
    };
  } catch {
    return null;
  }
}

const photoPattern = supabasePhotoPattern();
// Next 16 refuses to optimize images from loopback addresses unless told otherwise; local Supabase is one.
const isLocalSupabase = photoPattern?.hostname === "127.0.0.1" || photoPattern?.hostname === "localhost";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: photoPattern ? [photoPattern] : [],
    ...(isLocalSupabase && process.env.NODE_ENV !== "production" ? { dangerouslyAllowLocalIP: true } : {}),
  },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Enables forbidden() / forbidden.tsx (used by requireAdmin for signed-in non-admins).
    authInterrupts: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const config = withNextIntl(nextConfig);

// Sentry's build step only uploads source maps; it runs when a DSN and an auth token are configured.
const finalConfig =
  process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.SENTRY_AUTH_TOKEN
    ? withSentryConfig(config, {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        silent: !process.env.CI,
      })
    : config;

export default function nextConfigFor(phase: string): NextConfig {
  // `next typegen` loads the config in the build phase too; it inlines nothing, so it is exempt.
  if (phase === PHASE_PRODUCTION_BUILD && !process.argv.includes("typegen")) assertBuildEnv();
  return finalConfig;
}
