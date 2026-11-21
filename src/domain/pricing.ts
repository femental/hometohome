import { addMonthsClamped, diffDays, isValidISODate, type ISODate } from "./dates";

export const MAX_STAY_MONTHS = 12;
const PRORATION_DAYS_PER_MONTH = 30;

export interface PriceInput {
  monthlyRent: number;
  extraPersonMonthlyFee: number;
  deposit: number;
  moveIn: ISODate;
  moveOut: ISODate;
  occupants: 1 | 2;
}

export interface PriceQuote {
  appliedMonthlyRent: number;
  fullMonths: number;
  extraDays: number;
  proratedAmount: number;
  stayTotal: number;
  firstRentAmount: number;
  deposit: number;
  firstPaymentTotal: number;
}

export type PricingErrorCode = "INVALID_RANGE" | "MIN_STAY" | "MAX_STAY";

export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PricingError";
  }
}

export function calculatePrice(input: PriceInput): PriceQuote {
  const { moveIn, moveOut, deposit } = input;

  if (!isValidISODate(moveIn) || !isValidISODate(moveOut) || moveOut <= moveIn) {
    throw new PricingError("INVALID_RANGE");
  }
  if (moveOut > addMonthsClamped(moveIn, MAX_STAY_MONTHS)) {
    throw new PricingError("MAX_STAY");
  }

  // Always measured from the original moveIn; chaining would drift after a clamp.
  let fullMonths = 0;
  while (
    fullMonths < MAX_STAY_MONTHS &&
    addMonthsClamped(moveIn, fullMonths + 1) <= moveOut
  ) {
    fullMonths++;
  }
  if (fullMonths < 1) throw new PricingError("MIN_STAY");

  const appliedMonthlyRent =
    input.occupants === 2 ? input.monthlyRent + input.extraPersonMonthlyFee : input.monthlyRent;
  const extraDays = diffDays(addMonthsClamped(moveIn, fullMonths), moveOut);
  const proratedAmount = Math.round((appliedMonthlyRent / PRORATION_DAYS_PER_MONTH) * extraDays);
  const stayTotal = appliedMonthlyRent * fullMonths + proratedAmount;
  const firstRentAmount = fullMonths === 1 ? stayTotal : appliedMonthlyRent;

  return {
    appliedMonthlyRent,
    fullMonths,
    extraDays,
    proratedAmount,
    stayTotal,
    firstRentAmount,
    deposit,
    firstPaymentTotal: firstRentAmount + deposit,
  };
}
