import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-41";
const uniqueEmail = () =>
  `e2e-inbox-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Ivy Inbox", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
}

async function isApple(page: Page) {
  return page.evaluate(() => {
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData;
    return /mac|iphone|ipad|ipod/i.test(uaData?.platform ?? navigator.platform);
  });
}

const KEY_GAP_MS = 10;
const type = (page: Page, text: string) => page.keyboard.type(text, { delay: KEY_GAP_MS });
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** The view's rows as "  "×depth + title (+ " ✓" when completed). */
async function viewRows(page: Page) {
  return page.locator("main [data-task-row]").evaluateAll((els) =>
    els.map((el) => {
      const r = el as HTMLElement;
      const depth = Math.round(parseFloat(r.style.marginLeft || "0") / 24);
      const text = r.querySelector(".tiptap")?.textContent ?? "";
      const done = r.querySelector('[role="checkbox"][data-state="checked"]') ? " ✓" : "";
      return `${"  ".repeat(depth)}${text}${done}`;
    }),
  );
}

const viewRow = (page: Page, text: string) =>
  page.locator("main [data-task-row]").filter({ has: page.locator(".tiptap", { hasText: text }) });

/** The server's Inbox, as titles in Inbox order. */
async function savedInbox(page: Page) {
  const res = await page.request.get("/api/v1/inbox");
  const body = (await res.json()) as {
    items: { taskId: string; position: string }[];
    tasks: { id: string; title: string }[];
  };
  return [...body.items]
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((i) => body.tasks.find((x) => x.id === i.taskId)?.title ?? "?");
}

async function personalWorkspace(page: Page) {
  const res = await page.request.get("/api/v1/workspaces");
  const body = (await res.json()) as
    { kind: string; id: string }[] | { items: { kind: string; id: string }[] };
  const list = Array.isArray(body) ? body : body.items;
  return list.find((w) => w.kind === "personal")?.id ?? "";
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
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/v1/lists/${id}`);
      return ((await res.json()) as { title?: string }).title;
    })
    .toBe(title);
  return id;
}

test.describe("Inbox", () => {
  test("New task row, Enter for the next, subtasks from the details body", async ({ page }) => {
    await signUpVerified(page);
    await page.getByRole("button", { name: "New task" }).click();
    await type(page, "Call the plumber");
    await page.keyboard.press("Enter");
    await type(page, "Buy groceries");
    await expect.poll(() => savedInbox(page)).toEqual(["Call the plumber", "Buy groceries"]);

    await page.reload();
    await expect.poll(() => viewRows(page)).toEqual(["Call the plumber", "Buy groceries"]);

    // The details panel edits the task's own page: a subtask there nests under it.
    await viewRow(page, "Call the plumber")
      .getByRole("button", { name: "Open details of Call the plumber" })
      .click();
    await expect(page).toHaveURL(/\/inbox\/tasks\/[0-9a-f-]+$/);
    const panel = page.getByRole("complementary", { name: "Task details" });
    // The body editor loads with the task's page.
    await expect(panel.locator("[data-task-body] [data-block-editor]")).toBeVisible();
    await panel.getByRole("textbox", { name: "Task title" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await type(page, "[] Find the number");
    await expect
      .poll(() => viewRows(page))
      .toEqual(["Call the plumber", "  Find the number", "Buy groceries"]);

    // Completed tasks stay in the Inbox but are hidden by default.
    await page.keyboard.press("Escape");
    await viewRow(page, "Buy groceries").getByRole("checkbox").click();
    await expect.poll(() => viewRows(page)).toEqual(["Call the plumber", "  Find the number"]);
  });

  test("Quick create, C and the New task chord start tasks in the Inbox", async ({ page }) => {
    await signUpVerified(page);
    await page.goto("/today");
    await sidebar(page).getByRole("button", { name: "Create" }).click();
    await page.getByRole("menuitem", { name: "New task" }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await type(page, "From quick create");
    await page.keyboard.press("Escape");
    await page.keyboard.press("c");
    await type(page, "From C");
    await page.keyboard.press("Escape");
    await page.keyboard.press((await isApple(page)) ? "Control+n" : "Alt+n");
    await type(page, "From the chord");
    await expect
      .poll(() => savedInbox(page))
      .toEqual(["From the chord", "From C", "From quick create"]);
  });

  test("Add to Inbox, Remove from list and Move to list", async ({ page }) => {
    await signUpVerified(page);
    const listId = await newList(page, "Errands");
    await page.getByRole("textbox", { name: "List title" }).press("Enter");
    await type(page, "[] Post a letter");
    // ⌘⇧I in the title adds it to the Inbox; it stays in the list.
    const mod = (await isApple(page)) ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+Shift+i`);
    await expect.poll(() => savedInbox(page)).toEqual(["Post a letter"]);

    // Remove from list: it leaves the list and stays in the Inbox.
    await page
      .locator("main [data-block-editor] > [data-block-id]")
      .filter({ hasText: "Post a letter" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from list" }).click();
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
        return ((await res.json()) as { items: unknown[] }).items.length;
      })
      .toBe(0);

    // And Move to list… from the Inbox puts it back at the end of the list.
    await sidebar(page).getByRole("link", { name: "Inbox" }).click();
    await viewRow(page, "Post a letter").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to list…" }).click();
    await page.getByRole("option", { name: "Errands" }).click();
    await expect.poll(() => savedInbox(page)).toEqual([]);
    const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
    const blocks = (await res.json()) as { items: { taskId: string | null }[] };
    expect(blocks.items.filter((b) => b.taskId)).toHaveLength(1);
  });
});

test.describe("Today", () => {
  test("new tasks are due on the day, overdue reschedules, completed moves tabs", async ({
    page,
  }) => {
    await signUpVerified(page);
    const workspaceId = await personalWorkspace(page);
    const created = await page.request.post("/api/v1/inbox/tasks", {
      // Cookie-authenticated writes must come from the app's origin (D-034).
      headers: { origin: new URL(page.url()).origin },
      data: {
        clientMutationId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        workspaceId,
        titleInline: [{ type: "text", text: "Renew passport" }],
        position: "a0",
        due: { date: "2020-01-01", time: "09:00" },
      },
    });
    expect(created.ok()).toBe(true);

    await page.goto("/today");
    await expect(page.getByRole("region", { name: "Overdue" })).toContainText("Renew passport");
    await page.getByRole("button", { name: "New task" }).click();
    await type(page, "Water the plants");
    await expect(viewRow(page, "Water the plants")).toContainText("Today");

    await page.getByRole("button", { name: /Reschedule all/ }).click();
    await expect(page.getByRole("region", { name: "Overdue" })).toHaveCount(0);
    await expect(viewRow(page, "Renew passport")).toContainText("9:00");

    await viewRow(page, "Water the plants").getByRole("checkbox").click();
    await expect(viewRow(page, "Water the plants")).toHaveCount(0);
    await page.getByRole("radio", { name: "Completed" }).click();
    await expect(viewRow(page, "Water the plants")).toBeVisible();

    // The new task also went to the Inbox.
    expect(await savedInbox(page)).toContain("Water the plants");

    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
  });
});
