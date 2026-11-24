import { beforeEach, expect, test, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  getClient: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => sentry);

import { reportProblem } from "@/server/observability";

beforeEach(() => vi.clearAllMocks());

test("without a DSN (no Sentry client) it only logs", () => {
  sentry.getClient.mockReturnValue(undefined);
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  reportProblem("refund failed", { refundId: "r1" });
  expect(spy).toHaveBeenCalledWith("[problem] refund failed", { refundId: "r1" });
  expect(sentry.captureMessage).not.toHaveBeenCalled();
  expect(sentry.captureException).not.toHaveBeenCalled();
  spy.mockRestore();
});

test("with Sentry on, errors are captured as exceptions and plain problems as messages", () => {
  sentry.getClient.mockReturnValue({});
  const err = new Error("pg down");
  reportProblem("webhook failed", { paymentId: "p1" }, err);
  expect(sentry.captureException).toHaveBeenCalledWith(err, { extra: { paymentId: "p1", problem: "webhook failed" } });
  reportProblem("payment aborted", { paymentId: "p1" });
  expect(sentry.captureMessage).toHaveBeenCalledWith("payment aborted", { level: "error", extra: { paymentId: "p1" } });
});
