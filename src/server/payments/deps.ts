import "server-only";
import { prisma } from "@/server/db";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { getUsdKrwRate } from "@/server/fx/rates";
import { defaultPortOneClient, portOneConfig } from "./portone";
import type { PayDeps } from "./service";

/** Production wiring for the payment services; null when no PG is configured (no secret, not fake mode). */
export function payDeps(now = new Date()): PayDeps | null {
  const config = portOneConfig();
  const pg = defaultPortOneClient(config);
  if (!pg) return null;
  const env = serverEnv();
  return {
    db: prisma,
    pg,
    email: defaultEmailSender(),
    now,
    appUrl: env.APP_URL,
    adminEmails: env.ADMIN_EMAILS,
    config,
    getRate: () => getUsdKrwRate(prisma, now),
  };
}
