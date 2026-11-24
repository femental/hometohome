const RETRYABLE = new Set(["40P01", "40001"]); // deadlock_detected, serialization_failure

function sqlState(e: unknown): unknown[] {
  if (typeof e !== "object" || e === null) return [];
  const err = e as {
    code?: unknown;
    cause?: { originalCode?: unknown; code?: unknown };
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } };
  };
  return [
    err.code,
    err.cause?.originalCode,
    err.cause?.code,
    err.meta?.driverAdapterError?.cause?.originalCode,
    err.meta?.driverAdapterError?.cause?.code,
  ];
}

/** True for a Postgres deadlock or serialization failure, which a retry of the whole transaction can fix. */
export function isRetryableTxError(e: unknown): boolean {
  return sqlState(e).some((c) => typeof c === "string" && RETRYABLE.has(c));
}

/**
 * Runs `fn` (a whole transaction) and retries it, up to `attempts` times in total, when Postgres
 * aborts it with a deadlock (40P01) or serialization failure (40001). Other errors are rethrown at once.
 */
export async function withSerializationRetry<T>(fn: () => Promise<T>, opts: { attempts?: number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !isRetryableTxError(e)) throw e;
      await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 40)));
    }
  }
}
