import { createTransport } from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../env.ts";
import { createMailer, createMemoryMailer, smtpOptions } from "./mailer.ts";

describe("smtpOptions", () => {
  it("uses Mailpit without auth or TLS by default", () => {
    const o = smtpOptions(loadEnv({}));
    expect(o).toMatchObject({ host: "localhost", port: 1026, secure: false });
    expect(o.auth).toBeUndefined();
  });

  it("turns on implicit TLS and auth for Hostinger on 465 (D-032)", () => {
    const env = loadEnv({
      SMTP_HOST: "smtp.hostinger.com",
      SMTP_PORT: "465",
      SMTP_USER: "sender@example.com",
      SMTP_PASS: "secret",
    });
    expect(smtpOptions(env)).toMatchObject({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: { user: "sender@example.com", pass: "secret" },
    });
  });

  it("lets SMTP_SECURE override the port default", () => {
    expect(smtpOptions(loadEnv({ SMTP_PORT: "465", SMTP_SECURE: "false" })).secure).toBe(false);
    expect(smtpOptions(loadEnv({ SMTP_PORT: "2465", SMTP_SECURE: "true" })).secure).toBe(true);
  });
});

describe("createMailer", () => {
  it("sends from MAIL_FROM with the message fields", async () => {
    const transport = createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, "sendMail");
    const mailer = createMailer(transport, "Flolist <no-reply@flolist.localhost>");
    const message = { to: "a@test.localhost", subject: "Hi", text: "t", html: "<p>h</p>" };
    await mailer.send(message);

    expect(spy).toHaveBeenCalledWith({ from: "Flolist <no-reply@flolist.localhost>", ...message });
    const info = (await spy.mock.results[0]?.value) as { message: string };
    expect(JSON.parse(info.message)).toMatchObject({
      from: { address: "no-reply@flolist.localhost", name: "Flolist" },
      subject: "Hi",
    });
  });

  it("records messages in the memory mailer", async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: "a@test.localhost", subject: "s", text: "t", html: "h" });
    expect(mailer.sent).toHaveLength(1);
  });
});
