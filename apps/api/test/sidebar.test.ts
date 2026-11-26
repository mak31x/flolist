import { outbox, sections } from "@flolist/db";
import { sectionSchema, sidebarEntrySchema, sidebarSchema, uuidv7 } from "@flolist/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_SECTIONS } from "../src/routes/sidebar.ts";
import { createTestDb, type TestDb } from "./db.ts";
import { as, makeList, makePersonalWorkspace, makeUser, send, testApp } from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const cmid = () => crypto.randomUUID();

async function sidebarOf(me: { id: string }) {
  const res = await testApp(t.db).request("/api/v1/sidebar", as(me));
  expect(res.status).toBe(200);
  return sidebarSchema.parse(await res.json());
}

async function newSection(me: { id: string }, title: string, position: string) {
  const id = uuidv7();
  const res = await testApp(t.db).request(
    "/api/v1/sections",
    as(me, send("POST", { clientMutationId: cmid(), id, title, position })),
  );
  expect(res.status).toBe(201);
  return sectionSchema.parse(await res.json());
}

describe("GET /api/v1/sidebar", () => {
  it("creates Favorites once, even for concurrent first requests", async () => {
    const me = await makeUser(t.db);
    const [a, b] = await Promise.all([sidebarOf(me), sidebarOf(me)]);
    expect(a.sections).toEqual(b.sections);
    expect(a.sections).toEqual([
      expect.objectContaining({ title: "Favorites", isDefault: true, collapsed: false }),
    ]);
    const rows = await t.db.select().from(sections).where(eq(sections.userId, me.id));
    expect(rows.length).toBe(1);
  });

  it("sorts sections by byte order of their keys, not by locale", async () => {
    const me = await makeUser(t.db);
    // "Z" < "a" in byte order but not in most collations.
    await newSection(me, "Lower", "a1");
    await newSection(me, "Upper", "Zz");
    const { sections: rows } = await sidebarOf(me);
    expect(rows.map((s) => s.title)).toEqual(["Upper", "Favorites", "Lower"]);
  });

  it("returns 401 without a user", async () => {
    expect((await testApp(t.db).request("/api/v1/sidebar")).status).toBe(401);
  });
});

describe("sections", () => {
  it("renames, collapses and reorders a section", async () => {
    const me = await makeUser(t.db);
    const s = await newSection(me, "Work", "a5");
    const res = await testApp(t.db).request(
      `/api/v1/sections/${s.id}`,
      as(
        me,
        send("PATCH", {
          clientMutationId: cmid(),
          baseVersion: 1,
          title: "Projects",
          collapsed: true,
          position: "a2",
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(sectionSchema.parse(await res.json())).toMatchObject({
      title: "Projects",
      collapsed: true,
      position: "a2",
      version: 2,
    });
  });

  it("deletes a section and unpins its lists without deleting them", async () => {
    const me = await makeUser(t.db);
    const personal = await makePersonalWorkspace(t.db, me);
    const s = await newSection(me, "Temp", "a5");
    const list = await makeList(t.db, me, { workspaceId: personal.id });
    const app = testApp(t.db);
    await app.request(
      `/api/v1/sidebar/entries/${list.id}`,
      as(me, send("PUT", { clientMutationId: cmid(), sectionId: s.id, position: "a0" })),
    );
    const res = await app.request(
      `/api/v1/sections/${s.id}`,
      as(me, send("DELETE", { clientMutationId: cmid() })),
    );
    expect(res.status).toBe(200);
    const sidebar = await sidebarOf(me);
    expect(sidebar.sections.map((x) => x.id)).not.toContain(s.id);
    expect(sidebar.entries).toEqual([]);
    expect((await app.request(`/api/v1/lists/${list.id}`, as(me))).status).toBe(200);

    const events = (await t.db.select().from(outbox).orderBy(asc(outbox.id)))
      .map((r) => r.event as { entity: string; op: string; id: string })
      .filter((e) => e.op === "delete" && (e.id === s.id || e.id === list.id));
    expect(events.map((e) => e.entity)).toEqual(["sidebarEntry", "section"]);
  });

  it("refuses to delete Favorites", async () => {
    const me = await makeUser(t.db);
    const { sections: rows } = await sidebarOf(me);
    const favorites = rows[0];
    if (!favorites) throw new Error("no Favorites");
    const res = await testApp(t.db).request(
      `/api/v1/sections/${favorites.id}`,
      as(me, send("DELETE", { clientMutationId: cmid() })),
    );
    expect(res.status).toBe(403);
  });

  it("validates titles and positions, and caps the number of sections", async () => {
    const me = await makeUser(t.db);
    const app = testApp(t.db);
    const post = (body: Record<string, unknown>) =>
      app.request(
        "/api/v1/sections",
        as(me, send("POST", { clientMutationId: cmid(), id: uuidv7(), ...body })),
      );
    expect((await post({ title: "  ", position: "a0" })).status).toBe(400);
    expect((await post({ title: "Ok", position: "zz top" })).status).toBe(400);

    await t.db.insert(sections).values(
      Array.from({ length: MAX_SECTIONS }, (_, i) => ({
        userId: me.id,
        title: `S${String(i)}`,
        position: `a${String(i % 10)}`,
      })),
    );
    expect((await post({ title: "One too many", position: "b00" })).status).toBe(403);
  });
});

describe("sidebar entries", () => {
  it("stars, moves and unstars a list", async () => {
    const me = await makeUser(t.db);
    const personal = await makePersonalWorkspace(t.db, me);
    const list = await makeList(t.db, me, { workspaceId: personal.id });
    const { sections: rows } = await sidebarOf(me);
    const favorites = rows[0];
    if (!favorites) throw new Error("no Favorites");
    const work = await newSection(me, "Work", "a5");
    const app = testApp(t.db);
    const put = (sectionId: string, position: string) =>
      app.request(
        `/api/v1/sidebar/entries/${list.id}`,
        as(me, send("PUT", { clientMutationId: cmid(), sectionId, position })),
      );

    const starred = sidebarEntrySchema.parse(await (await put(favorites.id, "a0")).json());
    expect(starred).toMatchObject({ sectionId: favorites.id, position: "a0", version: 1 });
    const moved = sidebarEntrySchema.parse(await (await put(work.id, "a3")).json());
    expect(moved).toMatchObject({ sectionId: work.id, position: "a3", version: 2 });

    const unstar = await app.request(
      `/api/v1/sidebar/entries/${list.id}`,
      as(me, send("DELETE", { clientMutationId: cmid() })),
    );
    expect(unstar.status).toBe(200);
    expect((await sidebarOf(me)).entries).toEqual([]);
    const again = await app.request(
      `/api/v1/sidebar/entries/${list.id}`,
      as(me, send("DELETE", { clientMutationId: cmid() })),
    );
    expect(again.status).toBe(404);
  });

  it("can't pin someone else's list or use someone else's section", async () => {
    const me = await makeUser(t.db);
    const other = await makeUser(t.db);
    const theirs = await makeList(t.db, other);
    const mine = await makeList(t.db, me);
    const mySection = await newSection(me, "Mine", "a5");
    const theirSection = await newSection(other, "Theirs", "a5");
    const app = testApp(t.db);
    const put = (listId: string, sectionId: string) =>
      app.request(
        `/api/v1/sidebar/entries/${listId}`,
        as(me, send("PUT", { clientMutationId: cmid(), sectionId, position: "a0" })),
      );
    expect((await put(theirs.id, mySection.id)).status).toBe(404);
    expect((await put(mine.id, theirSection.id)).status).toBe(404);
  });
});
