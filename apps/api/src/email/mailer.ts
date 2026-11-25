import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { Env } from "../env.ts";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends transactional email. Callers decide whether a failure is fatal. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

type SmtpEnv = Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASS">;

/** Nodemailer SMTP options from env (D-012). Port 465 means implicit TLS unless SMTP_SECURE says otherwise. */
export function smtpOptions(env: SmtpEnv): SMTPTransport.Options {
  const options: SMTPTransport.Options = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  if (env.SMTP_USER !== "") options.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
  return options;
}

/** Wraps any Nodemailer transporter; `from` is MAIL_FROM. */
export function createMailer(transport: Transporter, from: string): Mailer {
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

export function createSmtpMailer(env: SmtpEnv & Pick<Env, "MAIL_FROM">): Mailer {
  return createMailer(createTransport(smtpOptions(env)), env.MAIL_FROM);
}

/** Keeps every message in memory; for tests. */
export function createMemoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}
