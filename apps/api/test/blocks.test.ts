import { blocks, outbox } from "@flolist/db";
import {
  apiErrorSchema,
  blockBatchResultSchema,
  blockPageSchema,
  changeEventSchema,
  uuidv7,
  type BlockOp,
} from "@flolist/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import { as, makeList, makeUser, send, testApp } from "./factories.ts";

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
  const list = await makeList(t.db, me);
  return { me, list };
}

async function batch(
  who: { id: string },
  listId: string,
  ops: (BlockOp | Record<string, unknown>)[],
  clientMutationId = cmid(),
) {
  return testApp(t.db).request(
    `/api/v1/lists/${listId}/blocks/batch`,
    as(who, send("POST", { clientMutationId, ops })),
  );
}

async function ok(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  return blockBatchResultSchema.parse(await res.json());
}

async function page(who: { id: string }, listId: string) {
  const res = await testApp(t.db).request(`/api/v1/lists/${listId}/blocks`, as(who));
  expect(res.status).toBe(200);
  return blockPageSchema.parse(await res.json()).items;
}

describe("GET /api/v1/lists/:id/blocks", () => {
  it("returns live blocks sorted byte-wise by position", async () => {
    const { me, list } = await setup();
    expect(await page(me, list.id)).toEqual([]);
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: a, type: "paragraph", position: "aV", content: text("third") },
        { op: "upsert", id: b, type: "heading1", position: "a0", content: text("first") },
        { op: "upsert", id: c, type: "divider", position: "a0V" },
      ]),
    );
    const items = await page(me, list.id);
    expect(items.map((x) => x.id)).toEqual([b, c, a]);
    expect(items[1]).toMatchObject({
      type: "divider",
      content: { color: "gray" },
      containerType: "list",
      containerId: list.id,
      rootListId: list.id,
      createdBy: me.id,
      version: 1,
    });
  });
});

describe("POST /api/v1/lists/:id/blocks/batch", () => {
  it("creates blocks with defaults and answers with them", async () => {
    const { me, list } = await setup();
    const id = uuidv7();
    const body = await ok(
      await batch(me, list.id, [{ op: "upsert", id, type: "bullet", position: "a0", indent: 2 }]),
    );
    expect(body.deleted).toEqual([]);
    expect(body.blocks).toEqual([
      expect.objectContaining({
        id,
        type: "bullet",
        indent: 2,
        content: { inline: [] },
        version: 1,
      }),
    ]);
  });

  it("changes only the sent fields and bumps the version", async () => {
    const { me, list } = await setup();
    const id = uuidv7();
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id, type: "quote", position: "a0", content: text("old") },
      ]),
    );
    const body = await ok(
      await batch(me, list.id, [{ op: "upsert", id, content: text("new"), baseVersion: 1 }]),
    );
    expect(body.blocks[0]).toMatchObject({
      type: "quote",
      position: "a0",
      content: text("new"),
      version: 2,
    });
  });

  it("keeps fitting content on a type change, resets the rest and flattens indents", async () => {
    const { me, list } = await setup();
    const [a, b] = [uuidv7(), uuidv7()];
    await ok(
      await batch(me, list.id, [
        {
          op: "upsert",
          id: a,
          type: "bullet",
          position: "a0",
          indent: 3,
          content: text("keep me"),
        },
        { op: "upsert", id: b, type: "paragraph", position: "a1", content: text("goes") },
      ]),
    );
    const body = await ok(
      await batch(me, list.id, [
        { op: "upsert", id: a, type: "heading2" },
        { op: "upsert", id: b, type: "divider" },
      ]),
    );
    expect(body.blocks).toEqual([
      expect.objectContaining({ id: a, type: "heading2", indent: 0, content: text("keep me") }),
      expect.objectContaining({ id: b, type: "divider", content: { color: "gray" } }),
    ]);
  });

  it("moves blocks, optionally changing the indent", async () => {
    const { me, list } = await setup();
    const [a, b] = [uuidv7(), uuidv7()];
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: a, type: "numbered", position: "a0" },
        { op: "upsert", id: b, type: "paragraph", position: "a1" },
      ]),
    );
    await ok(
      await batch(me, list.id, [
        { op: "move", id: a, position: "a2", indent: 1 },
        { op: "move", id: b, position: "Zz", indent: 3 },
      ]),
    );
    const items = await page(me, list.id);
    expect(items.map((x) => [x.id, x.position, x.indent])).toEqual([
      [b, "Zz", 0],
      [a, "a2", 1],
    ]);
  });

  it("soft-deletes idempotently and restores on upsert (undo)", async () => {
    const { me, list } = await setup();
    const id = uuidv7();
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id, type: "paragraph", position: "a0", content: text("x") },
      ]),
    );
    expect((await ok(await batch(me, list.id, [{ op: "delete", id }]))).deleted).toEqual([id]);
    expect(await page(me, list.id)).toEqual([]);
    const [row] = await t.db.select().from(blocks).where(eq(blocks.id, id));
    expect(row).toMatchObject({ deletedBy: me.id, trashRootId: id, version: 2 });
    expect(row?.deletedAt).toBeInstanceOf(Date);

    // A second delete (another client, or a retry with a new id) is a no-op.
    expect((await ok(await batch(me, list.id, [{ op: "delete", id }]))).deleted).toEqual([]);
    // Deleting something that never existed is a no-op too.
    expect((await ok(await batch(me, list.id, [{ op: "delete", id: uuidv7() }]))).deleted).toEqual(
      [],
    );

    const restored = await ok(await batch(me, list.id, [{ op: "upsert", id }]));
    expect(restored.blocks[0]).toMatchObject({ id, content: text("x"), version: 3 });
    expect((await page(me, list.id)).map((x) => x.id)).toEqual([id]);
    const [after] = await t.db.select().from(blocks).where(eq(blocks.id, id));
    expect(after).toMatchObject({ deletedAt: null, deletedBy: null, trashRootId: null });
  });

  it("is atomic: one bad op rolls back the whole batch", async () => {
    const { me, list } = await setup();
    const good = uuidv7();
    const res = await batch(me, list.id, [
      { op: "upsert", id: good, type: "paragraph", position: "a0" },
      { op: "upsert", id: uuidv7(), content: text("no type or position") },
    ]);
    expect(res.status).toBe(400);
    const error = apiErrorSchema.parse(await res.json());
    expect(error.error.code).toBe("VALIDATION");
    expect(await page(me, list.id)).toEqual([]);
  });

  it("rejects content that doesn't fit the type, and missing moves", async () => {
    const { me, list } = await setup();
    const res = await batch(me, list.id, [
      { op: "upsert", id: uuidv7(), type: "divider", position: "a0", content: text("nope") },
    ]);
    expect(res.status).toBe(400);
    const move = await batch(me, list.id, [{ op: "move", id: uuidv7(), position: "a0" }]);
    expect(move.status).toBe(404);
  });

  it("validates the body: unknown types, bad positions, duplicate ids, unsafe links", async () => {
    const { me, list } = await setup();
    const id = uuidv7();
    const cases: Record<string, unknown>[][] = [
      [{ op: "upsert", id, type: "image", position: "a0" }],
      [{ op: "upsert", id, type: "paragraph", position: "not valid!" }],
      [
        { op: "delete", id },
        { op: "delete", id },
      ],
      [
        {
          op: "upsert",
          id,
          type: "paragraph",
          position: "a0",
          content: {
            inline: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "link", attrs: { href: "javascript:x" } }],
              },
            ],
          },
        },
      ],
    ];
    for (const ops of cases) expect((await batch(me, list.id, ops)).status).toBe(400);
  });

  it("never touches a block of another list", async () => {
    const { me, list } = await setup();
    const other = await makeList(t.db, me, { workspaceId: list.workspaceId });
    const id = uuidv7();
    await ok(
      await batch(me, other.id, [
        { op: "upsert", id, type: "paragraph", position: "a0", content: text("theirs") },
      ]),
    );

    expect((await batch(me, list.id, [{ op: "upsert", id, content: text("mine") }])).status).toBe(
      409,
    );
    expect((await batch(me, list.id, [{ op: "move", id, position: "a1" }])).status).toBe(404);
    expect((await batch(me, list.id, [{ op: "delete", id }])).status).toBe(404);
    expect((await page(me, other.id))[0]).toMatchObject({ content: text("theirs"), version: 1 });
  });

  it("replays a retried mutation instead of applying it twice", async () => {
    const { me, list } = await setup();
    const id = uuidv7();
    await ok(await batch(me, list.id, [{ op: "upsert", id, type: "paragraph", position: "a0" }]));
    const mutationId = cmid();
    const first = await ok(
      await batch(me, list.id, [{ op: "upsert", id, content: text("once") }], mutationId),
    );
    const again = await ok(
      await batch(me, list.id, [{ op: "upsert", id, content: text("once") }], mutationId),
    );
    expect(again).toEqual(first);
    expect((await page(me, list.id))[0]?.version).toBe(2);
  });

  it("emits block events on the list channel with the mutation id", async () => {
    const { me, list } = await setup();
    const [a, b] = [uuidv7(), uuidv7()];
    await ok(
      await batch(me, list.id, [{ op: "upsert", id: a, type: "paragraph", position: "a0" }]),
    );
    const mutationId = cmid();
    await ok(
      await batch(
        me,
        list.id,
        [
          { op: "delete", id: a },
          { op: "upsert", id: b, type: "heading3", position: "a1", content: text("Hi") },
        ],
        mutationId,
      ),
    );
    const rows = (await t.db.select().from(outbox).orderBy(asc(outbox.id))).filter(
      (r) => (r.event as { clientMutationId?: string }).clientMutationId === mutationId,
    );
    expect(rows.map((r) => r.channels)).toEqual([[`list:${list.id}`], [`list:${list.id}`]]);
    const events = rows.map((r) => changeEventSchema.parse(r.event));
    expect(events.map((e) => [e.op, e.entity, e.id, e.version])).toEqual([
      ["delete", "block", a, 2],
      ["upsert", "block", b, 1],
    ]);
  });

  it("hides another user's list (404) and refuses signed-out callers (401)", async () => {
    const { list } = await setup();
    const stranger = await makeUser(t.db);
    expect(
      (await testApp(t.db).request(`/api/v1/lists/${list.id}/blocks`, as(stranger))).status,
    ).toBe(404);
    expect((await batch(stranger, list.id, [{ op: "delete", id: uuidv7() }])).status).toBe(404);
    const anonymous = await testApp(t.db).request(
      `/api/v1/lists/${list.id}/blocks/batch`,
      send("POST", { clientMutationId: cmid(), ops: [{ op: "delete", id: uuidv7() }] }),
    );
    expect(anonymous.status).toBe(401);
  });
});
