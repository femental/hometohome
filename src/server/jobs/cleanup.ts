import "server-only";
import { payDeps } from "@/server/payments/deps";
import { reconcileProcessingRefunds } from "@/server/payments/refunds";
import { cleanupStalePayments } from "@/server/payments/service";
import { cleanupOrphanPhotos } from "@/server/photos/service";
import type { PhotoStorage } from "@/server/photos/storage";
import type { JobDeps } from "./expire";

/** Daily housekeeping; each step reports how many rows/files it handled. */
export async function runDailyCleanup(d: JobDeps, photos?: PhotoStorage): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (photos) out.orphanPhotosDeleted = (await cleanupOrphanPhotos(d.db, photos, d.now)).deleted;
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
