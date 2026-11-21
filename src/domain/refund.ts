import { addDays, endOfDayKST, startOfDayKST, type ISODate } from "./dates";

/** Last instant a guest may cancel for a full refund: end of the day 7 days before move-in (KST). */
export function cancellationDeadline(moveIn: ISODate): Date {
  return endOfDayKST(addDays(moveIn, -7));
}

export type RefundDecision =
  | { kind: "full" | "deposit_only"; amountKrw: number }
  | { kind: "not_allowed"; amountKrw: 0 };

export function decideRefund(a: {
  firstPaymentTotal: number;
  deposit: number;
  moveIn: ISODate;
  now: Date;
  actor: "guest" | "admin";
}): RefundDecision {
  if (a.now.getTime() >= startOfDayKST(a.moveIn).getTime()) {
    return { kind: "not_allowed", amountKrw: 0 };
  }
  if (a.actor === "admin") return { kind: "full", amountKrw: a.firstPaymentTotal };
  if (a.now.getTime() <= cancellationDeadline(a.moveIn).getTime()) {
    return { kind: "full", amountKrw: a.firstPaymentTotal };
  }
  return { kind: "deposit_only", amountKrw: a.deposit };
}
