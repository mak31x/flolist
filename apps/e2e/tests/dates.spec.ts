import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-dates-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Dee Dates", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
}

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

async function newList(page: Page, title: string) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Create" })
    .click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  const field = page.getByRole("textbox", { name: "List title" });
  await expect(field).toBeFocused();
  await field.fill(title);
  await field.press("Enter");
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]+$/);
  return page.url().split("/").at(-1) ?? "";
}

interface SavedTask {
  content: { inline?: { text?: string }[] };
  task: {
    due: { date: string; time: string | null; tz: string } | null;
    priority: number;
    labelIds: string[];
  } | null;
}

async function savedTasks(page: Page, listId: string): Promise<SavedTask[]> {
  const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
  const items = ((await res.json()) as { items: SavedTask[] }).items;
  return items.filter((b) => b.task !== null);
}

const titleOf = (b: SavedTask) => (b.content.inline ?? []).map((n) => n.text ?? "").join("");

/** Tomorrow in UTC: new accounts start in the UTC zone (D-022). */
function tomorrowUtc() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

test("natural language: 'pay rent tomorrow at 5pm' sets the date and strips the phrase", async ({
  page,
}) => {
  await signUpVerified(page);
  const listId = await newList(page, "Bills");

  await type(page, "[] pay rent tomorrow at 5pm");
  const suggestion = page.getByRole("button", { name: "Set the due date to Tomorrow 5:00 pm" });
  await expect(suggestion).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(suggestion).toBeHidden();

  const row = page.locator("main [data-block-editor] > [data-block-id]").first();
  await expect(row.locator(".tiptap")).toHaveText("pay rent");
  await expect(row.getByRole("button", { name: "Due Tomorrow 5:00 pm" })).toBeVisible();

  await expect
    .poll(async () => {
      const [task] = await savedTasks(page, listId);
      return task ? { title: titleOf(task), due: task.task?.due } : null;
    })
    .toEqual({
      title: "pay rent",
      due: { date: tomorrowUtc(), time: "17:00", tz: "UTC" },
    });

  // Esc ignores a suggestion; the phrase stays in the title.
  await page.keyboard.press("Enter");
  await type(page, "call mom friday");
  await expect(page.getByRole("button", { name: /^Set the due date to/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Set the due date to/ })).toBeHidden();
  await expect
    .poll(async () => (await savedTasks(page, listId)).map(titleOf))
    .toEqual(["pay rent", "call mom friday"]);
});

test("details chips: due date, priority and labels, then Settings → Labels", async ({ page }) => {
  await signUpVerified(page);
  const listId = await newList(page, "Home");
  const mod = await modKey(page);

  await type(page, "[] Water plants");
  await page.keyboard.press(`${mod}+Enter`);
  const panel = page.locator("[data-task-body]").locator("..");
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();

  await panel.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Due Today" })).toBeVisible();

  await panel.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(panel.getByRole("button", { name: "High" })).toBeVisible();

  await panel.getByRole("button", { name: "Labels" }).click();
  const search = page.getByRole("combobox", { name: "Search or create a label" });
  await search.fill("Garden");
  await search.press("Enter");
  await expect(page.getByRole("option", { name: "Garden" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Garden" })).toBeVisible();

  await expect
    .poll(async () => {
      const [task] = await savedTasks(page, listId);
      return task?.task
        ? { priority: task.task.priority, labels: task.task.labelIds.length }
        : null;
    })
    .toEqual({ priority: 3, labels: 1 });

  // The activity log records the changes.
  await expect(page.getByText(/set the priority to High/)).toBeVisible();
  await expect(page.getByText(/added “Garden”/)).toBeVisible();

  await page.goto("/settings/labels");
  await expect(page.getByText("Garden", { exact: true })).toBeVisible();
  await expect(page.getByText("1 task", { exact: true })).toBeVisible();
});
