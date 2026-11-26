import { blocks, lists, sidebarEntries, tasks, userSettings } from "@flolist/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GETTING_STARTED, GETTING_STARTED_TITLE } from "../src/auth/getting-started.ts";
import { ensurePersonalWorkspace } from "../src/auth/personal-workspace.ts";
import { createTestDb, type TestDb } from "./db.ts";
import {
  as,
  makeList,
  makePersonalWorkspace,
  makeSection,
  makeUser,
  testApp,
} from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const listsOf = (userId: string) => t.db.select().from(lists).where(eq(lists.createdBy, userId));

describe("Getting started list", () => {
  it("is seeded once with the workspace: tasks, a subtask, starred", async () => {
    const me = await makeUser(t.db);
    await ensurePersonalWorkspace(t.db, me.id);
    await ensurePersonalWorkspace(t.db, me.id);

    const mine = await listsOf(me.id);
    expect(mine.map((l) => l.title)).toEqual([GETTING_STARTED_TITLE]);
    const listId = mine[0]?.id ?? "";
    const rows = await t.db.select().from(blocks).where(eq(blocks.rootListId, listId));
    const taskCount = GETTING_STARTED.reduce(
      (n, item) => n + (item.kind === "task" ? 1 + (item.subtasks?.length ?? 0) : 0),
      0,
    );
    expect(rows.filter((b) => b.type === "task")).toHaveLength(taskCount);
    expect(rows.some((b) => b.containerType === "task")).toBe(true);
    const seeded = await t.db.select().from(tasks).where(eq(tasks.listId, listId));
    expect(seeded).toHaveLength(taskCount);
    expect(seeded.filter((x) => x.parentTaskId !== null)).toHaveLength(1);

    const entries = await t.db
      .select()
      .from(sidebarEntries)
      .where(eq(sidebarEntries.userId, me.id));
    expect(entries.map((e) => e.listId)).toEqual([listId]);

    // The API serves it like any list.
    const res = await testApp(t.db).request(`/api/v1/lists/${listId}/blocks`, as(me));
    expect(res.status).toBe(200);
  });

  it("isn't seeded again after the user deletes it", async () => {
    const me = await makeUser(t.db);
    await ensurePersonalWorkspace(t.db, me.id);
    const [seeded] = await listsOf(me.id);
    await t.db
      .update(lists)
      .set({ deletedAt: new Date() })
      .where(eq(lists.id, seeded?.id ?? ""));
    await ensurePersonalWorkspace(t.db, me.id);
    expect((await listsOf(me.id)).filter((l) => l.deletedAt === null)).toEqual([]);
  });

  it("is backfilled for an earlier account on GET /me, at the end of Favorites", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const section = await makeSection(t.db, me, { isDefault: true });
    const older = await makeList(t.db, me, { workspaceId: ws.id, title: "Older" });
    await t.db
      .insert(sidebarEntries)
      .values({ userId: me.id, listId: older.id, sectionId: section.id, position: "a0" });
    await t.db.insert(userSettings).values({ userId: me.id }).onConflictDoNothing();

    expect((await testApp(t.db).request("/api/v1/me", as(me))).status).toBe(200);
    const titles = (await listsOf(me.id)).map((l) => l.title).sort();
    expect(titles).toEqual([GETTING_STARTED_TITLE, "Older"]);
    const entries = await t.db
      .select()
      .from(sidebarEntries)
      .where(eq(sidebarEntries.userId, me.id));
    const seeded = entries.find((e) => e.listId !== older.id);
    expect(seeded && seeded.position > "a0").toBe(true);
  });
});
