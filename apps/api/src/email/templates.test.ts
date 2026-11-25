import { describe, expect, it } from "vitest";
import { escapeHtml, resetPasswordMessage, verifyEmailMessage } from "./templates.ts";

const url = "https://flolist.localhost/api/auth/verify-email?token=a&callbackURL=%2Finbox";

describe("email templates", () => {
  it("puts the link in both the text and HTML parts", () => {
    const m = verifyEmailMessage({ to: "a@test.localhost", name: "Ada", url });
    expect(m.to).toBe("a@test.localhost");
    expect(m.subject).toBe("Verify your email for Flolist");
    expect(m.text).toContain(url);
    expect(m.text.startsWith("Hi Ada,")).toBe(true);
    expect(m.html).toContain(`href="${escapeHtml(url)}"`);
  });

  it("escapes the user's name in HTML", () => {
    const m = resetPasswordMessage({ to: "a@test.localhost", name: "<b>Eve</b>", url });
    expect(m.html).toContain("Hi &lt;b&gt;Eve&lt;/b&gt;,");
    expect(m.html).not.toContain("<b>Eve</b>");
  });

  it("falls back to a plain greeting without a name", () => {
    expect(verifyEmailMessage({ to: "a@test.localhost", name: " ", url }).text).toMatch(/^Hi,\n/);
  });
});
