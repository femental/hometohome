import "server-only";
import type { Db } from "@/server/db";
import type { EmailSender } from "./sender";
import { renderEmail, type TemplateData, type TemplateName } from "./templates";

const MAX_ERROR_LENGTH = 500;

/**
 * Renders and sends an email, recording the outcome in email_log.
 * Never throws: email failures must not undo business work.
 */
export async function sendEmail(
  db: Db,
  sender: EmailSender,
  a: { to: string; template: TemplateName; locale: "en" | "ko"; data: TemplateData; bookingId?: string },
): Promise<"sent" | "failed"> {
  let subject: string | undefined;
  let error: string | undefined;
  try {
    const m = renderEmail(a.template, a.locale, a.data);
    subject = m.subject;
    await sender.send({ to: a.to, ...m });
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, MAX_ERROR_LENGTH);
  }

  const status = error === undefined ? "sent" : "failed";
  try {
    await db.emailLog.create({
      data: { toEmail: a.to, template: a.template, subject, bookingId: a.bookingId, status, error },
    });
  } catch (e) {
    console.error("[email] failed to write email_log", e);
  }
  return status;
}
