import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { MemoryEmailSender } from "@/server/email/sender";
import { sendEmail } from "@/server/email/send";
import type { TemplateData } from "@/server/email/templates";
import { resetDb } from "./factories";

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const data: TemplateData = {
  guestName: "Gina",
  houseName: "Hongdae House",
  roomName: "Room 101",
  moveIn: "2027-03-15",
  lastNight: "2027-06-14",
  reason: "Dates conflict",
};

test("sendEmail sends and logs sent with bookingId", async () => {
  const sender = new MemoryEmailSender();
  const bookingId = randomUUID();
  const r = await sendEmail(prisma, sender, {
    to: "gina@example.com",
    template: "request_rejected",
    locale: "en",
    data,
    bookingId,
  });
  expect(r).toBe("sent");
  expect(sender.sent).toHaveLength(1);
  expect(sender.sent[0].to).toBe("gina@example.com");
  const logs = await prisma.emailLog.findMany();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    toEmail: "gina@example.com",
    template: "request_rejected",
    bookingId,
    status: "sent",
    error: null,
  });
  expect(logs[0].subject).toBe(sender.sent[0].subject);
});

test("sendEmail logs failed and does not throw when the sender fails", async () => {
  const sender = new MemoryEmailSender();
  sender.failNext = true;
  const r = await sendEmail(prisma, sender, {
    to: "gina@example.com",
    template: "request_rejected",
    locale: "ko",
    data,
  });
  expect(r).toBe("failed");
  expect(sender.sent).toHaveLength(0);
  const [log] = await prisma.emailLog.findMany();
  expect(log.status).toBe("failed");
  expect(log.error).toBeTruthy();
});

test("sendEmail logs failed (no throw) when rendering fails", async () => {
  const sender = new MemoryEmailSender();
  const r = await sendEmail(prisma, sender, {
    to: "gina@example.com",
    template: "request_approved",
    locale: "en",
    data,
  });
  expect(r).toBe("failed");
  const [log] = await prisma.emailLog.findMany();
  expect(log).toMatchObject({ status: "failed", subject: null });
  expect(log.error).toMatch(/payUrl/);
});
