// Browser Sentry, loaded only when NEXT_PUBLIC_SENTRY_DSN is set (keeps the bundle small otherwise).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0,
    }),
  );
}
