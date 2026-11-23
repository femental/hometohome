import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/server/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Implementations throw on failure. */
export interface EmailSender {
  send(m: EmailMessage): Promise<void>;
}

/** Test double: records messages; `failNext` makes the next send throw once. */
export class MemoryEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  failNext?: boolean;

  async send(m: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("MemoryEmailSender: simulated failure");
    }
    this.sent.push(m);
  }
}

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(m: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  }
}

/** Local/dev sender: logs subject and recipient only (never the body). */
export class ConsoleEmailSender implements EmailSender {
  async send(m: EmailMessage): Promise<void> {
    console.info(`[email] to=${m.to} subject=${m.subject}`);
  }
}

export function defaultEmailSender(): EmailSender {
  const env = serverEnv();
  return env.RESEND_API_KEY
    ? new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : new ConsoleEmailSender();
}
