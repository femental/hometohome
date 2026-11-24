import "server-only";
import { prisma } from "@/server/db";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { runDailyCleanup } from "./cleanup";
import { runExpiry, runPaymentReminders, type JobDeps } from "./expire";

function jobDeps(now = new Date()): JobDeps {
  const env = serverEnv();
  return { db: prisma, email: defaultEmailSender(), now, appUrl: env.APP_URL, adminEmails: env.ADMIN_EMAILS };
}

/** Runs a named scheduled job and returns a JSON-able summary; null for an unknown job name. */
export async function runJob(name: string): Promise<Record<string, number> | null> {
  if (name === "frequent") {
    const d = jobDeps();
    const expired = await runExpiry(d);
    const reminders = await runPaymentReminders(d);
    return {
      requestExpired: expired.requestExpired.length,
      paymentExpired: expired.paymentExpired.length,
      reminders: reminders.length,
    };
  }
  if (name === "daily") return runDailyCleanup(jobDeps());
  return null;
}
