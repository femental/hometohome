import "server-only";
import type { JobDeps } from "./expire";

/** Daily housekeeping; each later step reports how many rows/files it handled. */
export async function runDailyCleanup(d: JobDeps): Promise<Record<string, number>> {
  void d;
  return {};
}
