import { lists, outbox, sidebarEntries } from "@flolist/db";
import {
  apiErrorSchema,
  createListResultSchema,
  listIndexItemSchema,
  listIndexSchema,
  sidebarSchema,
  uuidv7,
} from "@flolist/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function signedUp() {
  const me = await makeUser(t.db);
  const personal = await makePersonalWorkspace(t.db, me);
  return { me, personal };
}

async function create(me: { id: string }, body: Record<string, unknown> = {}) {
  const res = await testApp(t.db).request(
    "/api/v1/lists",
    as(me, send("POST", { clientMutationId: cmid(), id: uuidv7(), ...body })),
  );
  return res;
}

async function outboxFor(id: string) {
  const rows = await t.db.select().from(outbox).orderBy(asc(outbox.id));
  return rows.filter((r) => (r.event as { id?: string }).id === id);
}

describe("POST /api/v1/lists", () => {
  it("creates a list in Personal and stars it at the end of Favorites", async () => {
    const { me, personal } = await signedUp();
    const first = createListResultSchema.parse(await (await create(me, { title: "One" })).json());
    const res = await create(me, { title: " Two ", emoji: "🛒" });
    expect(res.status).toBe(201);
    const body = createListResultSchema.parse(await res.json());
    expect(body.list).toMatchObject({
      title: "Two",
      emoji: "🛒",
      workspaceId: personal.id,
      createdBy: me.id,
      rootListId: body.list.id,
      parentListId: null,
      version: 1,
      lastOpenedAt: null,
    });
    expect(body.sidebarEntry.sectionId).toBe(first.sidebarEntry.sectionId);
    expect(body.sidebarEntry.position > first.sidebarEntry.position).toBe(true);

    const sidebar = sidebarSchema.parse(
      await (await testApp(t.db).request("/api/v1/sidebar", as(me))).json(),
    );
    expect(sidebar.sections).toEqual([
      expect.objectContaining({ title: "Favorites", isDefault: true }),
    ]);
    expect(sidebar.entries.map((e) => e.listId)).toEqual([first.list.id, body.list.id]);
  });

  it("writes change events for the list and the sidebar entry", async () => {
    const { me } = await signedUp();
    const mutationId = cmid();
    const id = uuidv7();
    await testApp(t.db).request(
      "/api/v1/lists",
      as(me, send("POST", { clientMutationId: mutationId, id, title: "Live" })),
    );
    const events = await outboxFor(id);
    expect(events.map((e) => [(e.event as { entity: string }).entity, e.channels])).toEqual([
      ["list", [`user:${me.id}`, `list:${id}`]],
      ["sidebarEntry", [`user:${me.id}`]],
    ]);
    expect(events[0]?.event).toMatchObject({
      type: "change",
      op: "upsert",
      clientMutationId: mutationId,
      data: { title: "Live" },
    });
  });

  it("uses the client's section and position when given", async () => {
    const { me } = await signedUp();
    const sectionId = uuidv7();
    await testApp(t.db).request(
      "/api/v1/sections",
      as(
        me,
        send("POST", { clientMutationId: cmid(), id: sectionId, title: "Work", position: "a3" }),
      ),
    );
    const res = await create(me, { sectionId, position: "a1" });
    expect(res.status).toBe(201);
    const body = createListResultSchema.parse(await res.json());
    expect(body.sidebarEntry).toMatchObject({ sectionId, position: "a1" });
  });

  it("refuses someone else's section and bad positions", async () => {
    const { me } = await signedUp();
    const other = await makeUser(t.db);
    const foreign = uuidv7();
    await testApp(t.db).request(
      "/api/v1/sections",
      as(
        other,
        send("POST", { clientMutationId: cmid(), id: foreign, title: "X", position: "a0" }),
      ),
    );
    expect((await create(me, { sectionId: foreign })).status).toBe(404);
    expect((await create(me, { position: "not a key" })).status).toBe(400);
  });

  it("replays a retried clientMutationId instead of creating twice", async () => {
    const { me } = await signedUp();
    const body = { clientMutationId: cmid(), id: uuidv7(), title: "Once" };
    const app = testApp(t.db);
    const a = await app.request("/api/v1/lists", as(me, send("POST", body)));
    const b = await app.request("/api/v1/lists", as(me, send("POST", body)));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await b.json()).toEqual(await a.json());
    expect((await outboxFor(body.id)).length).toBe(2);
  });

  it("answers CONFLICT for an id that's taken, and rolls the mutation back", async () => {
    const { me } = await signedUp();
    const id = uuidv7();
    expect((await create(me, { id })).status).toBe(201);
    const retryId = cmid();
    const res = await testApp(t.db).request(
      "/api/v1/lists",
      as(me, send("POST", { clientMutationId: retryId, id })),
    );
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("CONFLICT");
    // The failed mutation left nothing behind, so its id can be reused.
    const again = await testApp(t.db).request(
      "/api/v1/lists",
      as(me, send("POST", { clientMutationId: retryId, id: uuidv7() })),
    );
    expect(again.status).toBe(201);
  });

  it("returns 401 without a user and 400 without a mutation id", async () => {
    const app = testApp(t.db);
    expect((await app.request("/api/v1/lists", send("POST", { id: uuidv7() }))).status).toBe(401);
    const { me } = await signedUp();
    expect(
      (await app.request("/api/v1/lists", as(me, send("POST", { id: uuidv7() })))).status,
    ).toBe(400);
  });
});

describe("GET /api/v1/lists", () => {
  it("lists the caller's root lists newest first, without trashed ones or others' lists", async () => {
    const { me, personal } = await signedUp();
    const other = await makeUser(t.db);
    const older = await makeList(t.db, me, { title: "Older", workspaceId: personal.id });
    const newer = await makeList(t.db, me, { title: "Newer", workspaceId: personal.id });
    await makeList(t.db, me, { title: "Trashed", workspaceId: personal.id, deleted: true });
    await makeList(t.db, other, { title: "Not mine" });
    await t.db
      .update(lists)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(lists.id, older.id));

    const res = await testApp(t.db).request("/api/v1/lists", as(me));
    expect(res.status).toBe(200);
    const { items } = listIndexSchema.parse(await res.json());
    expect(items.map((l) => l.title)).toEqual([newer.title, older.title]);
  });

  it("reports when the caller last opened a list", async () => {
    const { me, personal } = await signedUp();
    const list = await makeList(t.db, me, { workspaceId: personal.id });
    const app = testApp(t.db);
    expect(
      (await app.request(`/api/v1/lists/${list.id}/open`, as(me, { method: "POST" }))).status,
    ).toBe(204);
    const item = listIndexItemSchema.parse(
      await (await app.request(`/api/v1/lists/${list.id}`, as(me))).json(),
    );
    expect(item.lastOpenedAt).not.toBeNull();
    const stranger = await makeUser(t.db);
    const res = await app.request(
      `/api/v1/lists/${list.id}/open`,
      as(stranger, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/lists/:id", () => {
  it("changes only the sent fields and bumps the version", async () => {
    const { me, personal } = await signedUp();
    const list = await makeList(t.db, me, { title: "Old", workspaceId: personal.id });
    const app = testApp(t.db);
    const a = await app.request(
      `/api/v1/lists/${list.id}`,
      as(me, send("PATCH", { clientMutationId: cmid(), baseVersion: 1, emoji: "🎯" })),
    );
    expect(a.status).toBe(200);
    expect(listIndexItemSchema.parse(await a.json())).toMatchObject({
      title: "Old",
      emoji: "🎯",
      version: 2,
    });
    // A stale baseVersion still applies its own field (field-level last-write-wins).
    const b = await app.request(
      `/api/v1/lists/${list.id}`,
      as(me, send("PATCH", { clientMutationId: cmid(), baseVersion: 1, title: "New" })),
    );
    expect(listIndexItemSchema.parse(await b.json())).toMatchObject({
      title: "New",
      emoji: "🎯",
      version: 3,
    });
    const events = await outboxFor(list.id);
    expect(events.map((e) => (e.event as { version: number }).version)).toEqual([2, 3]);
  });

  it("clears the emoji with null and refuses an empty patch", async () => {
    const { me, personal } = await signedUp();
    const list = await makeList(t.db, me, { workspaceId: personal.id });
    const app = testApp(t.db);
    const cleared = await app.request(
      `/api/v1/lists/${list.id}`,
      as(me, send("PATCH", { clientMutationId: cmid(), baseVersion: 1, emoji: null })),
    );
    expect(listIndexItemSchema.parse(await cleared.json()).emoji).toBeNull();
    const empty = await app.request(
      `/api/v1/lists/${list.id}`,
      as(me, send("PATCH", { clientMutationId: cmid(), baseVersion: 1 })),
    );
    expect(empty.status).toBe(400);
  });
});

describe("DELETE /api/v1/lists/:id", () => {
  it("moves the list to Trash, keeps its sidebar entry hidden, and is idempotent per mutation", async () => {
    const { me } = await signedUp();
    const created = createListResultSchema.parse(await (await create(me, { title: "Bye" })).json());
    const id = created.list.id;
    const app = testApp(t.db);
    const body = { clientMutationId: cmid() };
    const res = await app.request(`/api/v1/lists/${id}`, as(me, send("DELETE", body)));
    expect(res.status).toBe(200);
    // A retry after a lost response replays instead of answering 404.
    expect((await app.request(`/api/v1/lists/${id}`, as(me, send("DELETE", body)))).status).toBe(
      200,
    );

    const [row] = await t.db.select().from(lists).where(eq(lists.id, id));
    expect(row).toMatchObject({ deletedBy: me.id, trashRootId: id, version: 2 });
    expect(row?.deletedAt).not.toBeNull();
    expect((await app.request(`/api/v1/lists/${id}`, as(me))).status).toBe(404);

    const entries = await t.db.select().from(sidebarEntries).where(eq(sidebarEntries.listId, id));
    expect(entries.length).toBe(1);
    const sidebar = sidebarSchema.parse(
      await (await app.request("/api/v1/sidebar", as(me))).json(),
    );
    expect(sidebar.entries.find((e) => e.listId === id)).toBeUndefined();

    const deleteEvents = (await outboxFor(id)).filter(
      (e) => (e.event as { op: string }).op === "delete",
    );
    expect(deleteEvents.length).toBe(1);
  });
});
