import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { MemoryEmailSender } from "@/server/email/sender";
import { runExpiry, runPaymentReminders, type JobDeps } from "@/server/jobs/expire";
import { makeBooking, makeGuest, makeRoom, resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const now = new Date("2027-03-01T03:00:00Z");
const HOUR = 3600_000;

function deps(o: Partial<JobDeps> = {}): JobDeps & { email: MemoryEmailSender } {
  return {
    db: prisma,
    email: new MemoryEmailSender(),
    now,
    appUrl: "http://localhost:3000",
    adminEmails: ["admin@example.com"],
    ...o,
  } as JobDeps & { email: MemoryEmailSender };
}

async function booking(status: "requested" | "awaiting_payment", o: { requestExpiresAt?: Date; holdExpiresAt?: Date } = {}) {
  const guest = await makeGuest(prisma, { email: `g${Math.random().toString(36).slice(2)}@example.com` });
  const room = await makeRoom(prisma);
  return makeBooking(prisma, { roomId: room.id, guestId: guest.id, moveIn: "2027-03-15", moveOut: "2027-05-15", status, ...o });
}

describe("runExpiry", () => {
  test("expires stale requests and holds and emails each guest once, even when run twice", async () => {
    const r = await booking("requested", { requestExpiresAt: new Date(now.getTime() - 1) });
    const h = await booking("awaiting_payment", { holdExpiresAt: new Date(now.getTime() - 1) });
    const live = await booking("awaiting_payment", { holdExpiresAt: new Date(now.getTime() + HOUR) });
    const d = deps();
    const first = await runExpiry(d);
    expect(first).toEqual({ requestExpired: [r.id], paymentExpired: [h.id] });
    await runExpiry(d);
    const templates = (await prisma.emailLog.findMany({ orderBy: { template: "asc" } })).map((e) => [e.template, e.bookingId]);
    expect(templates).toEqual([
      ["payment_expired", h.id],
      ["request_expired", r.id],
    ]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("awaiting_payment");
  });

  test("a booking already marked expired by another path still gets its notice once", async () => {
    const h = await booking("awaiting_payment", { holdExpiresAt: new Date(now.getTime() - HOUR) });
    await prisma.booking.update({ where: { id: h.id }, data: { status: "payment_expired" } });
    await runExpiry(deps());
    await runExpiry(deps());
    expect(await prisma.emailLog.count({ where: { bookingId: h.id, template: "payment_expired" } })).toBe(1);
  });
});

describe("runPaymentReminders", () => {
  test("goes out once within 3h of the hold expiring, not for later holds", async () => {
    const soon = await booking("awaiting_payment", { holdExpiresAt: new Date(now.getTime() + 2 * HOUR) });
    const later = await booking("awaiting_payment", { holdExpiresAt: new Date(now.getTime() + 5 * HOUR) });
    const d = deps();
    expect(await runPaymentReminders(d)).toEqual([soon.id]);
    expect(await runPaymentReminders(d)).toEqual([]);
    expect(await prisma.emailLog.count({ where: { template: "payment_reminder" } })).toBe(1);
    expect(await prisma.emailLog.count({ where: { bookingId: later.id } })).toBe(0);
  });

  test("two concurrent runs send one email", async () => {
    await booking("awaiting_payment", { holdExpiresAt: new Date(now.getTime() + HOUR) });
    await Promise.all([runPaymentReminders(deps()), runPaymentReminders(deps())]);
    expect(await prisma.emailLog.count({ where: { template: "payment_reminder" } })).toBe(1);
  });
});
