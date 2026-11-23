import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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

export default nextConfig;
