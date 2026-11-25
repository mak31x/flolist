import type { Db } from "@flolist/db";
import { createApp } from "../src/app.ts";
import { createAuth, sessionResolver } from "../src/auth/auth.ts";
import { createMemoryMailer, type EmailMessage } from "../src/email/mailer.ts";
import { DEV_AUTH_SECRET } from "../src/env.ts";
import { silentLogger } from "../src/lib/logger.ts";

export const APP_URL = "http://localhost:5174";

/** A full app with real Better Auth on the test database and an in-memory mailer. */
export function authTestApp(db: Db, opts: { authRateLimit?: number } = {}) {
  const mailer = createMemoryMailer();
  const auth = createAuth({
    db,
    mailer,
    logger: silentLogger,
    appUrl: APP_URL,
    secret: DEV_AUTH_SECRET,
  });
  let ip = 0;
  const app = createApp({
    db,
    auth,
    resolveUser: sessionResolver(auth),
    appUrl: APP_URL,
    authRateLimit: { limit: opts.authRateLimit ?? 1000, windowMs: 60_000 },
    // Each test client gets its own IP unless it sets x-test-ip, so limits don't leak between tests.
    clientKey: (c) => c.req.header("x-test-ip") ?? `10.0.0.${String((ip += 1) % 250)}`,
  });

  /** Waits for the background email to a recipient (sent fire-and-forget by Better Auth hooks). */
  async function emailTo(to: string, subject: RegExp): Promise<EmailMessage> {
    for (let i = 0; i < 100; i += 1) {
      const found = mailer.sent.findLast((m) => m.to === to && subject.test(m.subject));
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no email to ${to} matching ${String(subject)}`);
  }

  return { app, auth, mailer, emailTo };
}

/** The first URL in an email's text part. */
export function linkIn(message: EmailMessage): URL {
  const match = /https?:\/\/\S+/.exec(message.text);
  if (!match) throw new Error("email has no link");
  return new URL(match[0]);
}

/** `name=value` pairs from Set-Cookie, ready for a Cookie header. */
export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c !== "" && !c.endsWith("="))
    .join("; ");
}

export function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: APP_URL, ...headers },
  };
}
