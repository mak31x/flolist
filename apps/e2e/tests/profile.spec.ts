import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-profile-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

/** A valid 1×1 PNG. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Ada Profile", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
  return email;
}

test("edit the profile, upload a photo, and it all survives a reload", async ({ page }) => {
  const email = await signUpVerified(page);
  await page.goto("/settings/profile");

  await expect(page.getByLabel("Email")).toHaveValue(email);
  const first = page.getByLabel("First name");
  await expect(first).toHaveValue("Ada");
  await first.fill("Augusta");
  await first.press("Enter");
  await page.getByLabel("Last name").fill("King");
  await page.getByLabel("Last name").press("Enter");
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("AK");

  await page.getByRole("button", { name: /First day of the week:/ }).click();
  await page.getByRole("menuitem", { name: "Saturday", exact: true }).click();

  await page.getByRole("button", { name: /^Time zone:/ }).click();
  await page.getByRole("combobox").fill("kolkata");
  await page.getByRole("combobox").press("Enter");
  await expect(page.getByRole("button", { name: "Time zone: Asia/Kolkata" })).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload photo" }).click();
  await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1PX });
  await expect(page.getByRole("dialog", { name: "Crop your photo" })).toBeVisible();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save photo" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("First name")).toHaveValue("Augusta");
  await expect(page.getByLabel("Last name")).toHaveValue("King");
  await expect(page.getByRole("button", { name: /First day of the week: Saturday/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Time zone: Asia/Kolkata" })).toBeVisible();
  // The photo loads through /api/v1/files/:id → presigned GET.
  const photo = page.getByRole("img", { name: "Augusta King" }).first();
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img) => (img as { naturalWidth: number }).naturalWidth))
    .toBe(512);

  // My Week starts on Saturday now (the browser locale alone would say Sunday).
  await page.goto("/my-week");
  await expect(page.locator("section h2").first()).toContainText(/Sat/);
});
