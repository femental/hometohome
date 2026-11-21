export const DEFAULT_FX_MARGIN = 0.02;

const SCALE = 10_000; // rate and margin are held as integers in 1e-4 units

function ceilDiv(num: bigint, den: bigint): bigint {
  return (num + den - BigInt(1)) / den;
}

/**
 * KRW -> foreign minor units (e.g. USD cents), rounded up, with an FX margin.
 * Computed with BigInt so there is no floating-point drift:
 *   cents = ceil(amountKrw * (1 + margin) * 100 / krwPerUnit)
 * with margin and rate scaled by 1e4 (rate precision: 4 decimals).
 */
export function quoteForeignMinor(
  amountKrw: number,
  krwPerUnit: number,
  margin: number = DEFAULT_FX_MARGIN,
): number {
  if (!Number.isSafeInteger(amountKrw) || amountKrw < 0) throw new Error(`Invalid amountKrw: ${amountKrw}`);
  if (!Number.isFinite(krwPerUnit) || krwPerUnit <= 0) throw new Error(`Invalid krwPerUnit: ${krwPerUnit}`);
  if (!Number.isFinite(margin) || margin < 0) throw new Error(`Invalid margin: ${margin}`);

  const rate = BigInt(Math.round(krwPerUnit * SCALE));
  if (rate === BigInt(0)) throw new Error(`Invalid krwPerUnit: ${krwPerUnit}`);
  const marginScaled = BigInt(Math.round(margin * SCALE));
  // amount * (1 + m/S) * 100 / (rate/S) = amount * (S + m) * 100 / rate
  const num = BigInt(amountKrw) * (BigInt(SCALE) + marginScaled) * BigInt(100);
  return Number(ceilDiv(num, rate));
}

/**
 * Foreign-currency refund proportional to the KRW refund: chargedMinor * refundKrw / amountKrw,
 * rounded half up. A full refund returns chargedMinor exactly.
 */
export function proportionalRefundMinor(
  chargedMinor: number,
  amountKrw: number,
  refundKrw: number,
): number {
  for (const [name, v] of [["chargedMinor", chargedMinor], ["amountKrw", amountKrw], ["refundKrw", refundKrw]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Invalid ${name}: ${v}`);
  }
  if (refundKrw > amountKrw) throw new Error(`refundKrw (${refundKrw}) exceeds amountKrw (${amountKrw})`);
  if (refundKrw === amountKrw) return chargedMinor;
  // amountKrw > refundKrw >= 0, so amountKrw > 0
  const a = BigInt(amountKrw);
  return Number((BigInt(2) * BigInt(chargedMinor) * BigInt(refundKrw) + a) / (BigInt(2) * a));
}
