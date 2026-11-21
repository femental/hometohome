import { test, expect } from "vitest";
import { cancellationDeadline, decideRefund } from "@/domain/refund";

const a = { firstPaymentTotal: 1_300_000, deposit: 500_000, moveIn: "2027-03-15" };

test("deadline is moveIn-7 23:59:59.999 KST", () => {
  expect(cancellationDeadline("2027-03-15").toISOString()).toBe("2027-03-08T14:59:59.999Z");
});

test("guest: full until deadline, deposit only after, not allowed from move-in day", () => {
  expect(decideRefund({ ...a, actor: "guest", now: new Date("2027-03-08T14:59:59.999Z") })).toEqual({ kind: "full", amountKrw: 1_300_000 });
  expect(decideRefund({ ...a, actor: "guest", now: new Date("2027-03-08T15:00:00Z") })).toEqual({ kind: "deposit_only", amountKrw: 500_000 });
  expect(decideRefund({ ...a, actor: "guest", now: new Date("2027-03-14T15:00:00Z") })).toEqual({ kind: "not_allowed", amountKrw: 0 });
});

test("admin: always full before move-in, not allowed from move-in day", () => {
  expect(decideRefund({ ...a, actor: "admin", now: new Date("2027-03-12T00:00:00Z") })).toEqual({ kind: "full", amountKrw: 1_300_000 });
  expect(decideRefund({ ...a, actor: "admin", now: new Date("2027-03-14T15:00:00Z") })).toEqual({ kind: "not_allowed", amountKrw: 0 });
});

test("last instant before move-in day is still allowed", () => {
  expect(decideRefund({ ...a, actor: "admin", now: new Date("2027-03-14T14:59:59.999Z") }).kind).toBe("full");
});
