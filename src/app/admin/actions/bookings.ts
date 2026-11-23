"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  adminApprove,
  adminCancel,
  adminComplete,
  adminConfirmOffline,
  adminDepositReturned,
  adminMarkRefundDone,
  adminReject,
  type Deps,
} from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { defaultEmailSender } from "@/server/email/sender";
import { serverEnv } from "@/server/env";
import { attempt, BOOKING_NOT_FOUND, INVALID_FORM, type ActionResult } from "./messages";

// Every action starts with requireAdmin(): the page that renders a button is not a security boundary.
// Ids arrive from the client (bound arguments are serialized), so they are validated like form data.
// Only the actions are exported: every export of a "use server" file is a public endpoint.

const idSchema = z.uuid();

const note = z.string().trim().max(500, "메모는 500자 이내로 입력해 주세요.");

const rejectInput = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "거절 사유를 입력해 주세요.")
    .max(500, "거절 사유는 500자 이내로 입력해 주세요."),
});

const offlineInput = z.object({
  method: z.enum(["bank_transfer", "cash", "other"], { error: "결제 수단을 선택해 주세요." }),
  amountKrw: z
    .number({ error: "받은 금액을 숫자로 입력해 주세요." })
    .int("받은 금액은 원 단위 정수여야 합니다.")
    .positive("받은 금액은 0보다 커야 합니다.")
    .max(2_147_483_647, "금액이 너무 큽니다."),
  note,
});

const depositInput = z.object({ note });

const notFound: ActionResult = { ok: false, error: BOOKING_NOT_FOUND };

function deps(): Deps {
  const env = serverEnv();
  return { db: prisma, email: defaultEmailSender(), now: new Date(), appUrl: env.APP_URL, adminEmails: env.ADMIN_EMAILS };
}

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Blank -> undefined so the required-number message fires instead of coercing "" to 0. */
const num = (fd: FormData, key: string): number | undefined => {
  const s = str(fd, key).trim();
  return s === "" ? undefined : Number(s);
};

function parse<S extends z.ZodType>(schema: S, raw: unknown): { ok: true; data: z.output<S> } | { ok: false; result: ActionResult } {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) fieldErrors[issue.path.join(".") || "_form"] ??= issue.message;
  return { ok: false, result: { ok: false, error: INVALID_FORM, fieldErrors } };
}

function revalidateBooking(bookingId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
}

/** Runs a service call for one booking and refreshes the admin screens on success. */
async function run(bookingId: string, op: (id: string) => Promise<unknown>): Promise<ActionResult> {
  const r = await attempt(() => op(bookingId));
  if (!r.ok) return r;
  revalidateBooking(bookingId);
  return { ok: true };
}

export async function approveAction(bookingId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return notFound;
  return run(id.data, (b) => adminApprove(deps(), b));
}

export async function rejectAction(
  bookingId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return notFound;
  const input = parse(rejectInput, { reason: str(formData, "reason") });
  if (!input.ok) return input.result;
  return run(id.data, (b) => adminReject(deps(), b, input.data.reason));
}

export async function confirmOfflineAction(
  bookingId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return notFound;
  const input = parse(offlineInput, {
    method: str(formData, "method"),
    amountKrw: num(formData, "amountKrw"),
    note: str(formData, "note"),
  });
  if (!input.ok) return input.result;
  return run(id.data, (b) => adminConfirmOffline(deps(), b, input.data));
}

/** Cancels an unpaid hold or a confirmed booking (operator cancel = full refund before move-in). */
export async function cancelAction(bookingId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return notFound;
  return run(id.data, (b) => adminCancel(deps(), b));
}

/** Marks a manual (offline) pending refund as sent. */
export async function markRefundDoneAction(refundId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(refundId);
  if (!id.success) return notFound;
  const r = await attempt(() => adminMarkRefundDone(prisma, id.data, "", new Date()));
  if (!r.ok) return r;
  const payment = await prisma.payment.findUnique({ where: { id: r.value.paymentId }, select: { bookingId: true } });
  if (payment) revalidateBooking(payment.bookingId);
  return { ok: true };
}

export async function completeAction(bookingId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return notFound;
  return run(id.data, (b) => adminComplete(prisma, b, new Date()));
}

export async function depositReturnedAction(
  bookingId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return notFound;
  const input = parse(depositInput, { note: str(formData, "note") });
  if (!input.ok) return input.result;
  return run(id.data, (b) => adminDepositReturned(prisma, b, input.data.note, new Date()));
}
