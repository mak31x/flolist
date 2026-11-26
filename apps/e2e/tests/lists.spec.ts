import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-lists-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Lin Lists", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
}

/** A second window signed in as the same user (same session cookie). */
async function secondWindow(browser: Browser, first: Page) {
  const context = await browser.newContext({ storageState: await first.context().storageState() });
  const page = await context.newPage();
  await page.goto("/today");
  return page;
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const section = (page: Page, title: string) =>
  sidebar(page).getByRole("region", { name: new RegExp(`^(Collapse|Expand) ${title}$`) });

/** The titles of the lists in a sidebar section, top to bottom. */
const titlesIn = (page: Page, title: string) =>
  section(page, title).getByRole("listitem").getByRole("link");

async function newList(page: Page, title: string) {
  await sidebar(page).getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  const field = page.getByRole("textbox", { name: "List title" });
  await expect(field).toBeFocused();
  await field.fill(title);
  await field.press("Enter");
}

/** Drags with the mouse in small steps so dnd-kit's sensors see a real drag. */
async function drag(page: Page, from: Locator, to: Locator, offsetY = 0) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("drag target not visible");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + offsetY, { steps: 12 });
  await page.mouse.up();
}

test("lists and sections persist, reorder and sync live between two windows", async ({
  page,
  browser,
}) => {
  await signUpVerified(page);
  const other = await secondWindow(browser, page);
  await expect(section(other, "Favorites")).toBeVisible();

  // Create two lists in window A: both appear, starred, in window B.
  await newList(page, "Groceries");
  await newList(page, "Work");
  await expect(titlesIn(other, "Favorites")).toHaveText(["Groceries", "Work"]);

  // Rename and change the emoji from the list page.
  await page.getByRole("main").getByRole("button", { name: "Change emoji", exact: true }).click();
  await page.getByRole("button", { name: "💼" }).click();
  await expect(sidebar(other).getByRole("button", { name: "Change emoji: Work" })).toHaveText("💼");

  // Create a section from Quick create and name it.
  await sidebar(page).getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "New section" }).click();
  const name = sidebar(page).getByRole("textbox", { name: "Section title" });
  await expect(name).toBeFocused();
  await name.fill("Projects");
  await name.press("Enter");
  await expect(section(other, "Projects")).toBeVisible();

  // Reorder within Favorites: Work above Groceries.
  await drag(
    page,
    titlesIn(page, "Favorites").filter({ hasText: "Work" }),
    titlesIn(page, "Favorites").filter({ hasText: "Groceries" }),
    -6,
  );
  await expect(titlesIn(page, "Favorites")).toHaveText(["Work", "Groceries"]);
  await expect(titlesIn(other, "Favorites")).toHaveText(["Work", "Groceries"]);

  // Move Groceries into the empty Projects section.
  await drag(
    page,
    titlesIn(page, "Favorites").filter({ hasText: "Groceries" }),
    section(page, "Projects"),
  );
  await expect(titlesIn(page, "Projects")).toHaveText(["Groceries"]);
  await expect(titlesIn(other, "Projects")).toHaveText(["Groceries"]);
  await expect(titlesIn(other, "Favorites")).toHaveText(["Work"]);

  // Collapse a section: it's per user, so the other window follows.
  await sidebar(page).getByRole("button", { name: "Collapse Projects" }).click();
  await expect(sidebar(other).getByRole("button", { name: "Expand Projects" })).toBeVisible();

  // Everything survives a reload.
  await other.reload();
  await expect(titlesIn(other, "Favorites")).toHaveText(["Work"]);
  await expect(sidebar(other).getByRole("button", { name: "Expand Projects" })).toBeVisible();

  // Delete a list: it leaves the other window too, and All lists no longer shows it.
  await sidebar(page).getByRole("link", { name: "Work" }).click();
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Delete list" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/all-lists$/);
  await expect(titlesIn(other, "Favorites")).toHaveCount(0);
  await other.goto("/all-lists");
  const rows = other.getByRole("list", { name: "Lists" });
  await expect(rows.getByRole("link")).toHaveText(["Groceries"]);

  await other.context().close();
});
