import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
    // Photo uploads (max 4 MiB + multipart overhead) go through Server Actions; Vercel caps bodies at ~4.5 MB.
    serverActions: { bodySizeLimit: "5mb" },
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

export default withNextIntl(nextConfig);
