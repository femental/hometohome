import type { Instrumentation } from "next";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Server/edge Sentry. Without NEXT_PUBLIC_SENTRY_DSN nothing is loaded or sent. */
export async function register() {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

/** Uncaught errors from Server Components, route handlers, Server Actions and Proxy. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
