import { expect, test, type Browser, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-editor-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

// `E2E_CPU_THROTTLE=4 pnpm test:e2e` slows Chromium's CPU to reproduce busy-CI timing locally.
test.beforeEach(async ({ page }) => {
  const rate = Number(process.env.E2E_CPU_THROTTLE ?? 0);
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
});

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Eda Editor", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
}

async function secondWindow(browser: Browser, first: Page, url: string) {
  const context = await browser.newContext({ storageState: await first.context().storageState() });
  const page = await context.newPage();
  await page.goto(url);
  return page;
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

/**
 * Fast typing: 10 ms between keys (6,000 keys a minute, far beyond a human) instead of
 * Playwright's zero delay, which on a busy CI runner outpaces any real input.
 */
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

const rows = (page: Page) => page.locator("[data-block-editor] > [data-block-id]");

/** Each block as "type: text" (markers like bullets and numbers are left out). */
async function outline(page: Page) {
  return rows(page).evaluateAll((els) =>
    els.map((el) => {
      const type = (el as HTMLElement).dataset.blockType ?? "?";
      const text = el.querySelector(".tiptap")?.textContent ?? "";
      const indent = (el.firstElementChild?.nextElementSibling as HTMLElement | null)?.style
        .paddingLeft;
      return `${type}${indent ? `@${indent}` : ""}: ${text}`;
    }),
  );
}

/** Waits until the server has the blocks (the editor saves in the background). */
async function savedCount(page: Page, listId: string) {
  const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
  return ((await res.json()) as { items: unknown[] }).items.length;
}

test("writes a structured document with the keyboard only, and it survives a reload", async ({
  page,
  browser,
}) => {
  await signUpVerified(page);

  // New list: the title takes focus; Enter moves into the (empty) first block.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Create" })
    .click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  const title = page.getByRole("textbox", { name: "List title" });
  await expect(title).toBeFocused();
  await title.fill("Meeting notes");
  await expect(
    page.getByText("Start typing, or type '/' to choose a different content type"),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const listId = /\/lists\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? "";
  expect(listId).not.toBe("");

  // Full typing speed: every structural key must land in the right block.
  const kb = typist(page);
  await kb.type("## Agenda");
  await kb.press("Enter");
  await kb.type("- one");
  await kb.press("Enter");
  await kb.type("two");
  await kb.press("Tab");
  await kb.press("Enter");
  await kb.press("Enter"); // empty bullet → paragraph
  await kb.type("1. first");
  await kb.press("Enter");
  await kb.type("second");
  await kb.press("Enter");
  await kb.press("Enter");
  await kb.type("> quoted");
  await kb.press("Enter");
  await kb.press("Enter");
  await kb.type("---"); // divider, caret moves to a new paragraph below
  await kb.type("The **end**");
  await kb.press("Enter");
  await kb.type("/head");
  await expect(page.getByRole("option", { name: "Heading 1" })).toBeVisible();
  await kb.press("ArrowDown");
  await kb.press("Enter");
  await kb.type("Notes");

  const expected = [
    "heading2: Agenda",
    "bullet: one",
    "bullet@24px: two",
    "numbered: first",
    "numbered: second",
    "quote: quoted",
    "divider: ",
    "paragraph: The end",
    "heading2: Notes",
  ];
  await expect.poll(() => outline(page)).toEqual(expected);
  await expect(rows(page).nth(7).locator("strong")).toHaveText("end");
  await expect(rows(page).nth(4)).toContainText("2.");

  // Undo the last typing burst, redo it.
  const mod = await modKey(page);
  await kb.press(`${mod}+z`);
  await expect.poll(() => outline(page)).toEqual([...expected.slice(0, -1), "heading2: "]);
  await kb.press(`${mod}+Shift+z`);
  await expect.poll(() => outline(page)).toEqual(expected);

  // Saved: a reload and a second window show the same document.
  await expect.poll(() => savedCount(page, listId), { timeout: 10_000 }).toBe(expected.length);
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
      const body = (await res.json()) as { items: { content: { inline?: { text?: string }[] } }[] };
      return body.items
        .at(-1)
        ?.content.inline?.map((n) => n.text)
        .join("");
    })
    .toBe("Notes");
  await page.reload();
  await expect.poll(() => outline(page)).toEqual(expected);

  // Live sync: typing in one window appears in the other.
  const other = await secondWindow(browser, page, `/lists/${listId}`);
  await expect.poll(() => outline(other)).toEqual(expected);
  await rows(page).nth(1).locator(".tiptap").click();
  await kb.press("End");
  await kb.type(" more");
  await expect.poll(() => outline(other), { timeout: 10_000 }).toContain("bullet: one more");
  await other.context().close();
});

test("block selection: Esc selects, Shift+↓ extends, Backspace deletes", async ({ page }) => {
  await signUpVerified(page);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Create" })
    .click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "List title" }).fill("Scratch");
  await page.keyboard.press("Enter");
  const kb = typist(page);
  for (const line of ["a", "b", "c", "d"]) {
    await kb.type(line);
    await kb.press("Enter");
  }
  await kb.type("e");
  await rows(page).nth(1).locator(".tiptap").click();
  await kb.press("Escape");
  await kb.press("Shift+ArrowDown");
  await expect(page.locator("[data-selected]")).toHaveCount(2);
  await expect(page.getByText("2 blocks selected")).toBeAttached();
  await kb.press("Backspace");
  await expect.poll(() => outline(page)).toEqual(["paragraph: a", "paragraph: d", "paragraph: e"]);
  // The caret is back in text, at the end of "a".
  await kb.type("!");
  await expect.poll(() => outline(page)).toEqual(["paragraph: a!", "paragraph: d", "paragraph: e"]);
  const mod = await modKey(page);
  await kb.press(`${mod}+z`);
  await kb.press(`${mod}+z`);
  await expect
    .poll(() => outline(page))
    .toEqual(["paragraph: a", "paragraph: b", "paragraph: c", "paragraph: d", "paragraph: e"]);
});
