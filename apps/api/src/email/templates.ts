import type { EmailMessage } from "./mailer.ts";

/**
 * Transactional email templates. Email clients don't support CSS variables, so the
 * colours here are inline literals copied from the Light theme in packages/ui/src/themes.css.
 */
const colors = {
  text: "#1f1f2e",
  muted: "#6b6b80",
  accent: "#e5533d",
  onAccent: "#ffffff",
  surface: "#fafafc",
  card: "#ffffff",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface ActionEmail {
  to: string;
  subject: string;
  greetingName: string;
  intro: string;
  action: string;
  url: string;
  outro: string;
}

function actionEmail(e: ActionEmail): EmailMessage {
  const greeting = e.greetingName.trim() === "" ? "Hi," : `Hi ${e.greetingName.trim()},`;
  const text = [
    greeting,
    "",
    e.intro,
    "",
    `${e.action}: ${e.url}`,
    "",
    e.outro,
    "",
    "— Flolist",
  ].join("\n");
  const url = escapeHtml(e.url);
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:32px 16px;background:${colors.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:${colors.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${colors.card};border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:${colors.accent};padding-bottom:24px">Flolist</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:12px">${escapeHtml(greeting)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:24px">${escapeHtml(e.intro)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${url}" style="display:inline-block;background:${colors.accent};color:${colors.onAccent};text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:999px">${escapeHtml(e.action)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:${colors.muted};padding-bottom:8px">${escapeHtml(e.outro)}</td></tr>
<tr><td style="font-size:12px;line-height:1.5;color:${colors.muted};word-break:break-all">${url}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: e.to, subject: e.subject, text, html };
}

export function verifyEmailMessage(input: { to: string; name: string; url: string }): EmailMessage {
  return actionEmail({
    to: input.to,
    subject: "Verify your email for Flolist",
    greetingName: input.name,
    intro: "Confirm your email address to finish setting up your Flolist account.",
    action: "Verify email",
    url: input.url,
    outro: "If you didn't sign up for Flolist, you can ignore this email.",
  });
}

export function resetPasswordMessage(input: {
  to: string;
  name: string;
  url: string;
}): EmailMessage {
  return actionEmail({
    to: input.to,
    subject: "Reset your Flolist password",
    greetingName: input.name,
    intro:
      "Someone asked to reset the password for your Flolist account. The link expires in 1 hour.",
    action: "Reset password",
    url: input.url,
    outro: "If you didn't ask for this, you can ignore this email; your password stays the same.",
  });
}
