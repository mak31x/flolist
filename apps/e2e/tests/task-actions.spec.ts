import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-actions-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Ada Actions", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
}

/** The app's `Mod` key for this browser (same rule as packages/ui `isApplePlatform`). */
async function modKey(page: Page) {
  return page.evaluate(() => {
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData;
    return /mac|iphone|ipad|ipod/i.test(uaData?.platform ?? navigator.platform)
      ? "Meta"
      : "Control";
  });
}

const KEY_GAP_MS = 10;
const type = (page: Page, text: string) => page.keyboard.type(text, { delay: KEY_GAP_MS });

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const rows = (page: Page) => page.locator("main [data-block-editor] > [data-block-id]");
const row = (page: Page, text: string) =>
  rows(page).filter({ has: page.locator(".tiptap", { hasText: text }) });

/** Each row as "type@depth: text", plus "✓" for completed tasks. */
async function outline(page: Page) {
  return rows(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el as HTMLElement;
      const text = r.querySelector(".tiptap")?.textContent ?? "";
      const done = r.querySelector('[role="checkbox"][data-state="checked"]') ? " ✓" : "";
      return `${r.dataset.blockType ?? "?"}@${r.dataset.depth ?? "0"}: ${text}${done}`;
    }),
  );
}

async function newList(page: Page, title: string) {
  await sidebar(page).getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  const field = page.getByRole("textbox", { name: "List title" });
  await expect(field).toBeFocused();
  await field.fill(title);
  await field.press("Enter");
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]+$/);
  const id = page.url().split("/").at(-1) ?? "";
  // The title saves in the background; moves and their activity entries read it from the server.
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/v1/lists/${id}`);
      return ((await res.json()) as { title?: string }).title;
    })
    .toBe(title);
  return id;
}

/** The server's tasks of a list page, as "title ✓?" in block order per container. */
async function savedTasks(page: Page, listId: string) {
  const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
  const items = (await res.json()) as {
    items: { type: string; content: { inline?: { text?: string }[] }; task: unknown }[];
  };
  return items.items
    .filter((b) => b.type === "task")
    .map((b) => (b.content.inline ?? []).map((n) => n.text ?? "").join(""))
    .sort();
}

/** "[] A", Enter, "B" + Tab (subtask of A), Enter twice (back out), "C". */
async function seedTasks(page: Page) {
  await type(page, "[] Plan trip");
  await page.keyboard.press("Enter");
  await type(page, "Book hotel");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await type(page, "Pack bags");
  await expect
    .poll(() => outline(page))
    .toEqual(["task@0: Plan trip", "task@1: Book hotel", "task@0: Pack bags"]);
}

test("task actions: context menu Duplicate copies the subtasks; Copy as Markdown nests them", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpVerified(page);
  const listId = await newList(page, "Trip");
  await seedTasks(page);

  await row(page, "Plan trip").locator(".tiptap").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Task actions" });
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect
    .poll(() => outline(page))
    .toEqual([
      "task@0: Plan trip",
      "task@1: Book hotel",
      "task@0: Plan trip",
      "task@1: Book hotel",
      "task@0: Pack bags",
    ]);
  await expect
    .poll(() => savedTasks(page, listId))
    .toEqual(["Book hotel", "Book hotel", "Pack bags", "Plan trip", "Plan trip"]);

  await row(page, "Pack bags").locator(".tiptap").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Copy as Markdown" }).click();
  await row(page, "Plan trip").first().locator(".tiptap").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Copy as Markdown" }).click();
  await expect(page.getByText("Copied to clipboard").first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "- [ ] Plan trip\n    - [ ] Book hotel",
  );
});

test("multiselect: Mod-click and Shift-click select, the bar completes and moves to a list", async ({
  page,
}) => {
  await signUpVerified(page);
  const target = await newList(page, "Later");
  const listId = await newList(page, "Trip");
  await seedTasks(page);
  const mod = await modKey(page);

  // Mod-click toggles single rows; the subtask and the last task make two.
  await row(page, "Book hotel")
    .locator(".tiptap")
    .click({ modifiers: [mod] });
  await row(page, "Pack bags")
    .locator(".tiptap")
    .click({ modifiers: [mod] });
  const bar = page.getByRole("toolbar", { name: "Actions for the selected items" });
  await expect(bar).toContainText("2 selected");
  await expect(rows(page).and(page.locator("[data-selected]"))).toHaveCount(2);

  // Shift-click from the anchor selects the range.
  await row(page, "Plan trip")
    .locator(".tiptap")
    .click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("3 selected");

  await bar.getByRole("button", { name: "Mark complete" }).click();
  await expect
    .poll(() => outline(page))
    .toEqual(["task@0: Plan trip ✓", "task@1: Book hotel ✓", "task@0: Pack bags ✓"]);

  // Mod+D on the selection reopens them all.
  await page.keyboard.press(`${mod}+d`);
  await expect
    .poll(() => outline(page))
    .toEqual(["task@0: Plan trip", "task@1: Book hotel", "task@0: Pack bags"]);

  // Narrow to the subtask and Pack bags, then move them: the subtask becomes a top-level task.
  await row(page, "Plan trip")
    .locator(".tiptap")
    .click({ modifiers: [mod] });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Move to list…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to list" });
  await dialog.getByRole("combobox", { name: "Search lists" }).fill("lat");
  await expect(dialog.getByRole("option", { name: "Later" })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Search lists" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(bar).toBeHidden();
  await expect.poll(() => outline(page)).toEqual(["task@0: Plan trip"]);
  await expect.poll(() => savedTasks(page, target)).toEqual(["Book hotel", "Pack bags"]);
  await expect.poll(() => savedTasks(page, listId)).toEqual(["Plan trip"]);

  await sidebar(page).getByRole("link", { name: "Later" }).click();
  await expect.poll(() => outline(page)).toEqual(["task@0: Book hotel", "task@0: Pack bags"]);

  // The details panel logs the move.
  await row(page, "Book hotel").locator(".tiptap").click();
  await page.keyboard.press(`${mod}+Enter`);
  const panel = page.getByRole("complementary", { name: "Task details" });
  await expect(panel.getByText(/moved this task from “Trip” to “Later”/)).toBeVisible();

  // ⋮ → Delete closes the panel and removes the task.
  await panel.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(panel).toBeHidden();
  await expect.poll(() => outline(page)).toEqual(["task@0: Pack bags"]);
});
