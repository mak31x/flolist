import { expect, test, type Page } from "@playwright/test";
import { linkFromEmail } from "./mailpit.ts";

// Throwaway local account per run; the password is a test value, not a real credential.
const PASSWORD = "e2e-local-password-31";
const uniqueEmail = () =>
  `e2e-media-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@flolist.localhost`;

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signUpVerified(page: Page) {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Mia Media", email, password: PASSWORD, callbackURL: "/inbox" },
  });
  expect(res.ok()).toBe(true);
  await page.goto(await linkFromEmail(page.request, email, /Verify your email/));
  await expect(page).toHaveURL(/\/inbox$/);
}

interface SavedBlock {
  type: string;
  fileId: string | null;
  sublistId: string | null;
  content: Record<string, unknown>;
}

async function savedBlocks(page: Page, listId: string): Promise<SavedBlock[]> {
  const res = await page.request.get(`/api/v1/lists/${listId}/blocks`);
  return ((await res.json()) as { items: SavedBlock[] }).items;
}

const listIdOf = (page: Page) => /\/lists\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? "";

async function newList(page: Page, title: string) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Create" })
    .click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  const field = page.getByRole("textbox", { name: "List title" });
  await expect(field).toBeFocused();
  await field.fill(title);
  await page.keyboard.press("Enter");
}

/** Types "/query" in the focused empty block and picks the first match. */
async function slash(page: Page, query: string) {
  await page.keyboard.type(`/${query}`);
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Enter");
}

test("sublists, images, attachments, covers and duplicates", async ({ page }) => {
  await signUpVerified(page);
  await newList(page, "Trip");
  const listId = listIdOf(page);

  // Sublist: "/sublist" makes a row whose title takes focus; Enter continues below it.
  await slash(page, "sublist");
  const subTitle = page.getByRole("textbox", { name: "Sublist title" });
  await expect(subTitle).toBeFocused();
  await page.keyboard.type("Packing");
  await page.keyboard.press("Enter");

  // Image: "/image" opens the file picker; the block appears once the upload is checked.
  const chooser = page.waitForEvent("filechooser");
  await slash(page, "image");
  await (await chooser).setFiles({ name: "beach.png", mimeType: "image/png", buffer: PNG });
  const image = page.getByRole("button", { name: "View beach.png full screen" });
  await expect(image).toBeVisible();
  await expect
    .poll(
      async () => await image.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);

  // Attachment: any file type, shown with its name and size.
  await page.getByRole("textbox", { name: "Sublist title" }).click();
  await page.keyboard.press("Enter");
  const chooser2 = page.waitForEvent("filechooser");
  await slash(page, "attachment");
  await (
    await chooser2
  ).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByRole("button", { name: "Download notes.txt" })).toBeVisible();

  await expect
    .poll(async () => (await savedBlocks(page, listId)).map((b) => b.type).sort())
    .toEqual(["attachment", "image", "sublist"]);
  const blocks = await savedBlocks(page, listId);
  const sublistId = blocks.find((b) => b.type === "sublist")?.sublistId ?? "";
  expect(blocks.find((b) => b.type === "image")?.fileId).toBeTruthy();

  // The sublist opens as its own page with a breadcrumb back to its parent.
  await page.getByRole("button", { name: "Open Packing" }).click();
  await expect(page).toHaveURL(new RegExp(`/lists/${sublistId}$`));
  await expect(page.getByRole("textbox", { name: "List title" })).toHaveValue("Packing");
  const crumbs = page.getByRole("navigation", { name: "Parent lists" });
  await expect(crumbs.getByText("Packing")).toHaveAttribute("aria-current", "page");
  await crumbs.getByRole("link", { name: "Trip" }).click();
  await expect(page).toHaveURL(new RegExp(`/lists/${listId}$`));

  // Cover: Customize from the ⋮ menu; the right panel shows it.
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Cover: forest river" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Cover" }).locator("img")).toHaveAttribute(
    "src",
    /forest-river/,
  );

  // Sort: a view setting only, with a Reset chip.
  await page.getByRole("button", { name: "Filter and sort" }).click();
  await page.getByRole("menuitemradio", { name: "Alphabetical" }).click();
  const reset = page.getByRole("button", { name: /Sorted by Alphabetical/ });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toBeHidden();

  // Everything survives a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "View beach.png full screen" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sublist title" })).toHaveValue("Packing");

  // Duplicate list: an exact copy, sublist included, titled "(copy)".
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate list" }).click();
  await expect(page.getByRole("textbox", { name: "List title" })).toHaveValue("Trip (copy)");
  const copyId = listIdOf(page);
  expect(copyId).not.toBe(listId);
  const copied = await savedBlocks(page, copyId);
  expect(copied.map((b) => b.type).sort()).toEqual(blocks.map((b) => b.type).sort());
  expect(copied.find((b) => b.type === "sublist")?.sublistId).not.toBe(sublistId);
  await expect(page.getByRole("textbox", { name: "Sublist title" })).toHaveValue("Packing");
});

test("dragging a block onto a sublist row moves it into the sublist", async ({ page }) => {
  await signUpVerified(page);
  await newList(page, "Inbox zero");
  const listId = listIdOf(page);
  await page.keyboard.type("Move me");
  await page.keyboard.press("Enter");
  await slash(page, "sublist");
  await page.keyboard.type("Later");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await savedBlocks(page, listId)).map((b) => b.type))
    .toEqual(["paragraph", "sublist", "paragraph"]);
  const sublistId = (await savedBlocks(page, listId)).find((b) => b.type === "sublist")?.sublistId;

  const row = page.locator('[data-block-editor] > [data-block-type="paragraph"]').first();
  await row.hover();
  const handle = row.getByRole("button", { name: "Drag to move" });
  const target = page.getByRole("textbox", { name: "Sublist title" });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("no layout");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByText("Moved 1 block(s)")).toBeVisible();
  await expect
    .poll(async () => (await savedBlocks(page, listId)).map((b) => b.type))
    .toEqual(["sublist", "paragraph"]);
  const moved = await savedBlocks(page, sublistId ?? "");
  expect(moved.map((b) => b.content)).toEqual([{ inline: [{ type: "text", text: "Move me" }] }]);
});
