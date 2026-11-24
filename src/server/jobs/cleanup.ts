import "server-only";
import { payDeps } from "@/server/payments/deps";
import { reconcileProcessingRefunds } from "@/server/payments/refunds";
import { cleanupStalePayments } from "@/server/payments/service";
import type { JobDeps } from "./expire";

/** Daily housekeeping; each step reports how many rows/files it handled. */
export async function runDailyCleanup(d: JobDeps): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const pd = payDeps(d.now);
  if (pd) {
    const stale = await cleanupStalePayments(pd);
    out.stalePaymentsCancelled = stale.cancelled;
    out.stalePaymentsCompleted = stale.completed;
    const settled = await reconcileProcessingRefunds(pd);
    out.refundsSettled = settled.done;
    out.refundsStillProcessing = settled.stillPending;
  }
  return out;
}
