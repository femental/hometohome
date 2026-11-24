import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * An operational problem someone should look at (payment applied wrongly, refund failed, webhook
 * error). Goes to Sentry when it is configured (NEXT_PUBLIC_SENTRY_DSN), otherwise to the log.
 * `extra` carries ids only (booking, payment, refund) — never e-mail addresses or names.
 */
export function reportProblem(message: string, extra: Record<string, unknown> = {}, error?: unknown): void {
  if (!Sentry.getClient()) {
    console.error(`[problem] ${message}`, extra, ...(error === undefined ? [] : [error]));
    return;
  }
  if (error instanceof Error) Sentry.captureException(error, { extra: { ...extra, problem: message } });
  else Sentry.captureMessage(message, { level: "error", extra: error === undefined ? extra : { ...extra, error: String(error) } });
}
