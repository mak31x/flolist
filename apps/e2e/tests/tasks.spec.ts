import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-tasks-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Tia Tasks", email, password: PASSWORD, callbackURL: "/inbox" },
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
function typist(page: Page) {
  return {
    type: (text: string) => page.keyboard.type(text, { delay: KEY_GAP_MS }),
    press: async (key: string) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(KEY_GAP_MS);
    },
  };
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const rows = (page: Page) => page.locator("main [data-block-editor] > [data-block-id]");

/** Each row as "type@depth: text", plus "✓" for completed tasks. */
async function outline(page: Page) {
  return rows(page).evaluateAll((els) =>
    els.map((el) => {
      const row = el as HTMLElement;
      const text = row.querySelector(".tiptap")?.textContent ?? "";
      const done = row.querySelector('[role="checkbox"][data-state="checked"]') ? " ✓" : "";
      return `${row.dataset.blockType ?? "?"}@${row.dataset.depth ?? "0"}: ${text}${done}`;
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
  return page.url().split("/").at(-1) ?? "";
}

/** Waits until the server has `count` blocks for the page (the editor saves in the background). */
async function expectSaved(page: Page, listId: string, count: number) {
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
      return ((await res.json()) as { items: unknown[] }).items.length;
    })
    .toBe(count);
}

test("tasks: [] shortcut, Enter, Tab subtasks, completion and progress persist", async ({
  page,
}) => {
  await signUpVerified(page);
  const listId = await newList(page, "Trip");
  const k = typist(page);
  const mod = await modKey(page);

  await k.type("[] Book flights");
  await k.press("Enter");
  await k.type("Pick seats");
  await k.press("Tab");
  await k.press("Enter");
  await k.type("Pay deposit");
  await k.press("Enter");
  // Enter on an empty subtask moves it out a level.
  await k.press("Enter");
  await k.type("Pack bags");

  await expect
    .poll(() => outline(page))
    .toEqual([
      "task@0: Book flights",
      "task@1: Pick seats",
      "task@1: Pay deposit",
      "task@0: Pack bags",
    ]);
  const parent = rows(page).first();
  await expect(parent.getByRole("img", { name: "0 of 2 subtasks done" })).toBeVisible();

  // Complete a subtask by its checkbox, and the parent by Mod+D.
  await page.getByRole("checkbox", { name: "Complete Pick seats" }).click();
  await expect(parent.getByRole("img", { name: "1 of 2 subtasks done" })).toBeVisible();
  await parent.locator(".tiptap").click();
  await k.press(`${mod}+d`);
  await expect
    .poll(() => outline(page))
    .toEqual([
      "task@0: Book flights ✓",
      "task@1: Pick seats ✓",
      "task@1: Pay deposit",
      "task@0: Pack bags",
    ]);

  // Shift+Tab moves a subtask out, right below its parent.
  await page.getByText("Pay deposit").click();
  await k.press("Shift+Tab");
  await expect
    .poll(() => outline(page))
    .toEqual([
      "task@0: Book flights ✓",
      "task@1: Pick seats ✓",
      "task@0: Pay deposit",
      "task@0: Pack bags",
    ]);

  await expectSaved(page, listId, 4);
  await page.reload();
  await expect
    .poll(() => outline(page))
    .toEqual([
      "task@0: Book flights ✓",
      "task@1: Pick seats ✓",
      "task@0: Pay deposit",
      "task@0: Pack bags",
    ]);

  // Collapsing hides the subtasks.
  await page.getByRole("button", { name: "Hide subtasks" }).click();
  await expect
    .poll(() => outline(page))
    .toEqual(["task@0: Book flights ✓", "task@0: Pay deposit", "task@0: Pack bags"]);
  await page.getByRole("button", { name: "Show subtasks" }).click();

  // Filter menu: Hide completed tasks hides the done task and its subtasks.
  await page.getByRole("button", { name: "Filter and sort" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Hide completed tasks" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => outline(page)).toEqual(["task@0: Pay deposit", "task@0: Pack bags"]);
  await page.getByRole("button", { name: "Filter and sort" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Hide completed tasks" }).click();
  await page.keyboard.press("Escape");

  // ⋮ → Mark all incomplete reopens everything, subtasks included.
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Mark all incomplete" }).click();
  await expect
    .poll(() => outline(page))
    .toEqual([
      "task@0: Book flights",
      "task@1: Pick seats",
      "task@0: Pay deposit",
      "task@0: Pack bags",
    ]);
});

test("task details: open with Mod+Enter, rename, add subtasks in the body, activity, Esc", async ({
  page,
}) => {
  await signUpVerified(page);
  const listId = await newList(page, "Home");
  const k = typist(page);
  const mod = await modKey(page);

  await k.type("[] Fix the tap");
  await k.press(`${mod}+Enter`);
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  const panel = page.getByRole("complementary", { name: "Task details" });
  const title = panel.getByRole("textbox", { name: "Task title" });
  await expect(title).toHaveText("Fix the tap");

  // Rename in the panel: the list row follows.
  await title.click();
  await page.keyboard.press("End");
  await k.type(" in the kitchen");
  await expect(rows(page).first().locator(".tiptap")).toHaveText("Fix the tap in the kitchen");

  // Enter moves into the body; "[] " makes a subtask there, which the list nests.
  await k.press("Enter");
  await k.type("[] Buy washer");
  await expect(panel.locator("[data-block-editor] [data-block-type=task]")).toHaveCount(1);
  await expect
    .poll(() => outline(page))
    .toEqual(["task@0: Fix the tap in the kitchen", "task@1: Buy washer"]);

  await panel.getByRole("checkbox", { name: "Complete Fix the tap in the kitchen" }).click();
  await expect(panel.getByText(/created this task/)).toBeVisible();
  await expect(panel.getByText(/completed this task/)).toBeVisible();

  await expectSaved(page, listId, 2);
  await title.click();
  await k.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/lists/${listId}$`));
});
