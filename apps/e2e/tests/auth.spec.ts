import { expect, test } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = (tag: string) =>
  `e2e-${tag}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

test("sign up → verify the email → land in Inbox", async ({ page, request }) => {
  const email = uniqueEmail("signup");

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ada E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  const link = await linkFromEmail(request, email, /Verify your email/);
  await page.goto(link);

  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("AE");

  // The session survives a reload.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
});

test("an unverified account can't log in; a verified one logs out and back in", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("login");
  const signUp = await request.post("/api/auth/sign-up/email", {
    data: { name: "Grace E2E", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(signUp.ok()).toBe(true);

  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?redirect=%2Ftoday$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  // Sign-up sent one link (→ Inbox) and the refused log-in another (→ where they were going).
  await page.goto(await linkFromEmail(request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/(inbox|today)$/);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/today");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
});
