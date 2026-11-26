import { blocks, files, lists, outbox, sidebarEntries } from "@flolist/db";
import {
  apiErrorSchema,
  blockBatchResultSchema,
  blockPageSchema,
  changeEventSchema,
  duplicateListResultSchema,
  listIndexItemSchema,
  listIndexSchema,
  listViewPrefsSchema,
  uuidv7,
  type BlockOp,
} from "@flolist/shared";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import {
  as,
  makeList,
  makePersonalWorkspace,
  makeSection,
  makeUser,
  send,
  testApp,
} from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const cmid = () => crypto.randomUUID();
const text = (s: string) => ({ inline: s === "" ? [] : [{ type: "text", text: s }] });

async function setup() {
  const me = await makeUser(t.db);
  const ws = await makePersonalWorkspace(t.db, me);
  const list = await makeList(t.db, me, { workspaceId: ws.id, title: "Trip" });
  return { me, ws, list };
}

async function readyFile(
  workspaceId: string,
  uploadedBy: string,
  over: Partial<typeof files.$inferInsert> = {},
) {
  const id = uuidv7();
  await t.db.insert(files).values({
    id,
    workspaceId,
    storageKey: `ws/${workspaceId}/${id}`,
    filename: "photo.png",
    mime: "image/png",
    sizeBytes: 1234,
    width: 800,
    height: 600,
    status: "ready",
    uploadedBy,
    ...over,
  });
  return id;
}

async function batch(
  who: { id: string },
  listId: string,
  ops: (BlockOp | Record<string, unknown>)[],
) {
  return testApp(t.db).request(
    `/api/v1/lists/${listId}/blocks/batch`,
    as(who, send("POST", { clientMutationId: cmid(), ops })),
  );
}

async function ok(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

async function errorCode(res: Response) {
  return apiErrorSchema.parse(await res.json()).error.code;
}

async function blocksOf(who: { id: string }, listId: string) {
  const res = await testApp(t.db).request(`/api/v1/lists/${listId}/blocks`, as(who));
  return blockPageSchema.parse(await ok(res)).items;
}

async function getList(who: { id: string }, id: string) {
  return testApp(t.db).request(`/api/v1/lists/${id}`, as(who));
}

describe("image and attachment blocks", () => {
  it("creates an image block from a ready file and fills in the file's details", async () => {
    const { me, ws, list } = await setup();
    const fileId = await readyFile(ws.id, me.id);
    const id = uuidv7();
    const result = blockBatchResultSchema.parse(
      await ok(
        await batch(me, list.id, [
          {
            op: "upsert",
            id,
            type: "image",
            position: "a0",
            fileId,
            // Whatever the client claims about the file is replaced by the file row.
            content: {
              caption: "Beach",
              file: { name: "x", mime: "text/html", sizeBytes: 1, width: 1, height: 1 },
            },
          },
        ]),
      ),
    );
    expect(result.blocks[0]).toMatchObject({
      id,
      type: "image",
      fileId,
      sublistId: null,
      content: {
        caption: "Beach",
        file: { name: "photo.png", mime: "image/png", sizeBytes: 1234, width: 800, height: 600 },
      },
    });
  });

  it("accepts any ready file for an attachment and lets the caption change later", async () => {
    const { me, ws, list } = await setup();
    const fileId = await readyFile(ws.id, me.id, {
      filename: "notes.pdf",
      mime: "application/pdf",
      width: null,
      height: null,
    });
    const id = uuidv7();
    await ok(
      await batch(me, list.id, [{ op: "upsert", id, type: "attachment", position: "a0", fileId }]),
    );
    const [block] = await blocksOf(me, list.id);
    expect(block?.content).toEqual({
      caption: "",
      file: {
        name: "notes.pdf",
        mime: "application/pdf",
        sizeBytes: 1234,
        width: null,
        height: null,
      },
    });

    await ok(
      await batch(me, list.id, [{ op: "upsert", id, content: { caption: "v2", file: null } }]),
    );
    const [after] = await blocksOf(me, list.id);
    expect(after?.content).toMatchObject({ caption: "v2", file: { name: "notes.pdf" } });
    expect(after?.fileId).toBe(fileId);
  });

  it("refuses missing, pending, foreign and non-image files", async () => {
    const { me, ws, list } = await setup();
    const other = await makeUser(t.db);
    const otherWs = await makePersonalWorkspace(t.db, other);
    const pending = await readyFile(ws.id, me.id, { status: "pending" });
    const foreign = await readyFile(otherWs.id, other.id);
    const pdf = await readyFile(ws.id, me.id, { mime: "application/pdf" });
    const image = (fileId?: string) => ({
      op: "upsert",
      id: uuidv7(),
      type: "image",
      position: "a0",
      ...(fileId ? { fileId } : {}),
    });
    for (const op of [image(), image(pending), image(foreign), image(pdf), image(uuidv7())]) {
      const res = await batch(me, list.id, [op]);
      expect(res.status).toBe(400);
    }
    const textWithFile = await batch(me, list.id, [
      { op: "upsert", id: uuidv7(), type: "paragraph", position: "a0", fileId: pdf },
    ]);
    expect(textWithFile.status).toBe(400);
    expect(await blocksOf(me, list.id)).toEqual([]);
  });

  it("never turns media or sublist blocks into other types, or the reverse", async () => {
    const { me, ws, list } = await setup();
    const fileId = await readyFile(ws.id, me.id);
    const img = uuidv7();
    const para = uuidv7();
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: img, type: "image", position: "a0", fileId },
        { op: "upsert", id: para, type: "paragraph", position: "a1", content: text("hi") },
      ]),
    );
    expect((await batch(me, list.id, [{ op: "upsert", id: img, type: "paragraph" }])).status).toBe(
      400,
    );
    expect((await batch(me, list.id, [{ op: "upsert", id: para, type: "sublist" }])).status).toBe(
      400,
    );
  });
});

describe("sublist blocks", () => {
  async function withSublist() {
    const ctx = await setup();
    const blockId = uuidv7();
    const subId = uuidv7();
    await ok(
      await batch(ctx.me, ctx.list.id, [
        {
          op: "upsert",
          id: blockId,
          type: "sublist",
          position: "a0",
          sublist: { id: subId, title: " Packing " },
        },
      ]),
    );
    return { ...ctx, blockId, subId };
  }

  it("creates the child list with the block, inheriting workspace and root", async () => {
    const { me, list, ws, blockId, subId } = await withSublist();
    const [block] = await blocksOf(me, list.id);
    expect(block).toMatchObject({ id: blockId, type: "sublist", sublistId: subId, content: {} });

    const sub = listIndexItemSchema.parse(await ok(await getList(me, subId)));
    expect(sub).toMatchObject({
      id: subId,
      title: "Packing",
      workspaceId: ws.id,
      rootListId: list.id,
      parentListId: list.id,
      parentBlockId: blockId,
      cover: null,
    });

    // The list index carries sublists too (for breadcrumbs and starring).
    const index = listIndexSchema.parse(
      await ok(await testApp(t.db).request("/api/v1/lists", as(me))),
    );
    expect(index.items.map((l) => l.id)).toEqual(expect.arrayContaining([list.id, subId]));

    // A sublist holds its own blocks, edited through the root's access.
    await ok(
      await batch(me, subId, [
        { op: "upsert", id: uuidv7(), type: "paragraph", position: "a0", content: text("socks") },
      ]),
    );
    expect(await blocksOf(me, subId)).toHaveLength(1);

    const events = await t.db.select().from(outbox).orderBy(asc(outbox.id));
    const listEvent = events
      .map((e) => changeEventSchema.parse(e.event))
      .find((e) => e.entity === "list" && e.id === subId);
    expect(listEvent?.op).toBe("upsert");
  });

  it("is NOT_FOUND for someone who can't see the parent", async () => {
    const { subId } = await withSublist();
    const stranger = await makeUser(t.db);
    expect((await getList(stranger, subId)).status).toBe(404);
    expect((await batch(stranger, subId, [{ op: "delete", id: uuidv7() }])).status).toBe(404);
  });

  it("requires the sublist on create and refuses it on other types", async () => {
    const { me, list } = await setup();
    const missing = await batch(me, list.id, [
      { op: "upsert", id: uuidv7(), type: "sublist", position: "a0" },
    ]);
    expect(missing.status).toBe(400);
    const stray = await batch(me, list.id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "paragraph",
        position: "a0",
        sublist: { id: uuidv7(), title: "x" },
      },
    ]);
    expect(stray.status).toBe(400);
  });

  it("trashes the sublist tree with its block, and undo brings it back", async () => {
    const { me, list, blockId, subId } = await withSublist();
    // A grandchild sublist goes along.
    const deepBlock = uuidv7();
    const deepId = uuidv7();
    await ok(
      await batch(me, subId, [
        {
          op: "upsert",
          id: deepBlock,
          type: "sublist",
          position: "a0",
          sublist: { id: deepId, title: "Deep" },
        },
      ]),
    );

    await ok(await batch(me, list.id, [{ op: "delete", id: blockId }]));
    expect((await getList(me, subId)).status).toBe(404);
    expect((await getList(me, deepId)).status).toBe(404);
    const trashed = await t.db.select().from(lists).where(eq(lists.trashRootId, blockId));
    expect(trashed.map((l) => l.id).sort()).toEqual([subId, deepId].sort());

    await ok(await batch(me, list.id, [{ op: "upsert", id: blockId, position: "a0" }]));
    expect((await getList(me, subId)).status).toBe(200);
    expect((await getList(me, deepId)).status).toBe(200);
  });

  it("deleting a sublist from its page also removes its row in the parent", async () => {
    const { me, list, blockId, subId } = await withSublist();
    const res = await testApp(t.db).request(
      `/api/v1/lists/${subId}`,
      as(me, send("DELETE", { clientMutationId: cmid() })),
    );
    await ok(res);
    expect(await blocksOf(me, list.id)).toEqual([]);
    const [block] = await t.db.select().from(blocks).where(eq(blocks.id, blockId));
    expect(block?.trashRootId).toBe(subId);
    expect((await getList(me, list.id)).status).toBe(200);
  });
});

describe("list covers", () => {
  async function patch(who: { id: string }, id: string, body: Record<string, unknown>) {
    const current = listIndexItemSchema.parse(await ok(await getList(who, id)));
    return testApp(t.db).request(
      `/api/v1/lists/${id}`,
      as(who, send("PATCH", { clientMutationId: cmid(), baseVersion: current.version, ...body })),
    );
  }

  it("sets a built-in or uploaded cover and removes it with null", async () => {
    const { me, ws, list } = await setup();
    const builtin = listIndexItemSchema.parse(
      await ok(await patch(me, list.id, { cover: { builtin: "forest-river" } })),
    );
    expect(builtin.cover).toEqual({ builtin: "forest-river" });

    const fileId = await readyFile(ws.id, me.id);
    const uploaded = listIndexItemSchema.parse(
      await ok(await patch(me, list.id, { cover: { fileId } })),
    );
    expect(uploaded.cover).toEqual({ fileId });

    const none = listIndexItemSchema.parse(await ok(await patch(me, list.id, { cover: null })));
    expect(none.cover).toBeNull();
  });

  it("refuses unknown built-ins, foreign files and non-images", async () => {
    const { me, ws, list } = await setup();
    const other = await makeUser(t.db);
    const otherWs = await makePersonalWorkspace(t.db, other);
    expect((await patch(me, list.id, { cover: { builtin: "nope" } })).status).toBe(400);
    const foreign = await readyFile(otherWs.id, other.id);
    expect((await patch(me, list.id, { cover: { fileId: foreign } })).status).toBe(404);
    const pdf = await readyFile(ws.id, me.id, { mime: "application/pdf" });
    const res = await patch(me, list.id, { cover: { fileId: pdf } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });
});

describe("POST /api/v1/lists/:id/duplicate", () => {
  it("copies the content and sublists, and stars the copy under the original", async () => {
    const { me, ws, list } = await setup();
    const section = await makeSection(t.db, me);
    await t.db
      .insert(sidebarEntries)
      .values([{ userId: me.id, listId: list.id, sectionId: section.id, position: "a0" }]);
    const other = await makeList(t.db, me, { workspaceId: ws.id });
    await t.db
      .insert(sidebarEntries)
      .values([{ userId: me.id, listId: other.id, sectionId: section.id, position: "a1" }]);
    const fileId = await readyFile(ws.id, me.id);
    const subId = uuidv7();
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: uuidv7(), type: "heading1", position: "a0", content: text("Plan") },
        { op: "upsert", id: uuidv7(), type: "image", position: "a1", fileId },
        {
          op: "upsert",
          id: uuidv7(),
          type: "sublist",
          position: "a2",
          sublist: { id: subId, title: "Packing" },
        },
      ]),
    );
    await ok(
      await batch(me, subId, [
        { op: "upsert", id: uuidv7(), type: "bullet", position: "a0", content: text("socks") },
      ]),
    );

    const copyId = uuidv7();
    const result = duplicateListResultSchema.parse(
      await ok(
        await testApp(t.db).request(
          `/api/v1/lists/${list.id}/duplicate`,
          as(me, send("POST", { clientMutationId: cmid(), id: copyId })),
        ),
        201,
      ),
    );
    expect(result.list).toMatchObject({ id: copyId, title: "Trip (copy)", parentListId: null });
    expect(result.sidebarEntry?.sectionId).toBe(section.id);
    const position = result.sidebarEntry?.position ?? "";
    expect(position > "a0" && position < "a1").toBe(true);

    const copied = await blocksOf(me, copyId);
    expect(copied.map((b) => b.type)).toEqual(["heading1", "image", "sublist"]);
    expect(copied[1]?.fileId).toBe(fileId);
    const subCopy = copied[2]?.sublistId;
    expect(subCopy).toBeTruthy();
    expect(subCopy).not.toBe(subId);
    const sub = listIndexItemSchema.parse(await ok(await getList(me, subCopy ?? "")));
    expect(sub).toMatchObject({
      title: "Packing",
      rootListId: copyId,
      parentListId: copyId,
      parentBlockId: copied[2]?.id,
    });
    expect((await blocksOf(me, subCopy ?? "")).map((b) => b.content)).toEqual([text("socks")]);
    // The original is untouched.
    expect(await blocksOf(me, list.id)).toHaveLength(3);
  });

  it("doesn't star a copy of an unstarred list, and hides lists from outsiders", async () => {
    const { me, list } = await setup();
    const result = duplicateListResultSchema.parse(
      await ok(
        await testApp(t.db).request(
          `/api/v1/lists/${list.id}/duplicate`,
          as(me, send("POST", { clientMutationId: cmid(), id: uuidv7() })),
        ),
        201,
      ),
    );
    expect(result.sidebarEntry).toBeNull();
    const entries = await t.db
      .select()
      .from(sidebarEntries)
      .where(and(eq(sidebarEntries.userId, me.id), eq(sidebarEntries.listId, result.list.id)));
    expect(entries).toEqual([]);

    const stranger = await makeUser(t.db);
    await makePersonalWorkspace(t.db, stranger);
    const res = await testApp(t.db).request(
      `/api/v1/lists/${list.id}/duplicate`,
      as(stranger, send("POST", { clientMutationId: cmid(), id: uuidv7() })),
    );
    expect(res.status).toBe(404);
  });
});

describe("list view prefs", () => {
  it("starts at the defaults and changes only the sent fields", async () => {
    const { me, list } = await setup();
    const app = testApp(t.db);
    const initial = listViewPrefsSchema.parse(
      await ok(await app.request(`/api/v1/lists/${list.id}/prefs`, as(me))),
    );
    expect(initial).toEqual({ sort: "manual", hideCompleted: false, tasksOnly: false });

    await ok(
      await app.request(
        `/api/v1/lists/${list.id}/prefs`,
        as(me, send("PATCH", { clientMutationId: cmid(), sort: "alphabetical" })),
      ),
    );
    const updated = listViewPrefsSchema.parse(
      await ok(
        await app.request(
          `/api/v1/lists/${list.id}/prefs`,
          as(me, send("PATCH", { clientMutationId: cmid(), tasksOnly: true })),
        ),
      ),
    );
    expect(updated).toEqual({ sort: "alphabetical", hideCompleted: false, tasksOnly: true });

    const events = (await t.db.select().from(outbox).orderBy(asc(outbox.id)))
      .map((e) => changeEventSchema.parse(e.event))
      .filter((e) => e.entity === "listPrefs" && e.id === list.id);
    expect(events).toHaveLength(2);
  });

  it("refuses an empty patch, bad sorts and outsiders", async () => {
    const { me, list } = await setup();
    const app = testApp(t.db);
    const path = `/api/v1/lists/${list.id}/prefs`;
    expect(
      (await app.request(path, as(me, send("PATCH", { clientMutationId: cmid() })))).status,
    ).toBe(400);
    expect(
      (await app.request(path, as(me, send("PATCH", { clientMutationId: cmid(), sort: "x" }))))
        .status,
    ).toBe(400);
    const stranger = await makeUser(t.db);
    expect((await app.request(path, as(stranger))).status).toBe(404);
    expect(
      (
        await app.request(
          path,
          as(stranger, send("PATCH", { clientMutationId: cmid(), tasksOnly: true })),
        )
      ).status,
    ).toBe(404);
  });
});

describe("POST /api/v1/lists/:id/blocks/move-to", () => {
  async function moveTo(who: { id: string }, from: string, ids: string[], targetListId: string) {
    return testApp(t.db).request(
      `/api/v1/lists/${from}/blocks/move-to`,
      as(who, send("POST", { clientMutationId: cmid(), ids, targetListId })),
    );
  }

  it("moves blocks to the end of another list, in order, sublists and all", async () => {
    const { me, ws, list } = await setup();
    const other = await makeList(t.db, me, { workspaceId: ws.id, title: "Other" });
    const [a, b, keep] = [uuidv7(), uuidv7(), uuidv7()];
    const subBlock = uuidv7();
    const subId = uuidv7();
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: a, type: "paragraph", position: "a0", content: text("a") },
        { op: "upsert", id: keep, type: "paragraph", position: "a1", content: text("keep") },
        { op: "upsert", id: b, type: "paragraph", position: "a2", content: text("b") },
        {
          op: "upsert",
          id: subBlock,
          type: "sublist",
          position: "a3",
          sublist: { id: subId, title: "S" },
        },
      ]),
    );
    const inner = uuidv7();
    await ok(
      await batch(me, subId, [
        { op: "upsert", id: inner, type: "paragraph", position: "a0", content: text("in") },
      ]),
    );
    await ok(
      await batch(me, other.id, [
        { op: "upsert", id: uuidv7(), type: "paragraph", position: "a0", content: text("x") },
      ]),
    );

    const result = blockBatchResultSchema.parse(
      await ok(await moveTo(me, list.id, [subBlock, b, a], other.id)),
    );
    expect(result.blocks.map((r) => r.id)).toEqual([a, b, subBlock]);
    expect((await blocksOf(me, list.id)).map((r) => r.id)).toEqual([keep]);
    const target = await blocksOf(me, other.id);
    expect(target.map((r) => r.content)).toEqual([text("x"), text("a"), text("b"), {}]);
    expect(target.every((r) => r.rootListId === other.id)).toBe(true);

    const sub = listIndexItemSchema.parse(await ok(await getList(me, subId)));
    expect(sub).toMatchObject({ parentListId: other.id, rootListId: other.id });
    const [innerRow] = await t.db.select().from(blocks).where(eq(blocks.id, inner));
    expect(innerRow?.rootListId).toBe(other.id);
  });

  it("refuses moving a sublist into itself, the same list, and others' lists", async () => {
    const { me, list } = await setup();
    const subBlock = uuidv7();
    const subId = uuidv7();
    const para = uuidv7();
    await ok(
      await batch(me, list.id, [
        {
          op: "upsert",
          id: subBlock,
          type: "sublist",
          position: "a0",
          sublist: { id: subId, title: "S" },
        },
        { op: "upsert", id: para, type: "paragraph", position: "a1", content: text("p") },
      ]),
    );
    expect((await moveTo(me, list.id, [subBlock], subId)).status).toBe(400);
    expect((await moveTo(me, list.id, [para], list.id)).status).toBe(400);
    expect((await moveTo(me, list.id, [uuidv7()], subId)).status).toBe(404);

    const stranger = await makeUser(t.db);
    const theirs = await makeList(t.db, stranger);
    expect((await moveTo(me, list.id, [para], theirs.id)).status).toBe(404);
    expect((await moveTo(stranger, list.id, [para], theirs.id)).status).toBe(404);
    // The paragraph moves into the sublist fine.
    await ok(await moveTo(me, list.id, [para], subId));
  });
});
