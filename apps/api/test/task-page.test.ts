import { blocks, outbox, tasks } from "@flolist/db";
import {
  apiErrorSchema,
  blockBatchResultSchema,
  channel,
  changeEventSchema,
  inboxPageSchema,
  taskPageSchema,
  uuidv7,
} from "@flolist/shared";
import { eq } from "drizzle-orm";
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
const content = (s: string) => ({ inline: [{ type: "text", text: s }] });

async function ok(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

async function code(res: Response) {
  return apiErrorSchema.parse(await res.json()).error.code;
}

const request = (who: { id: string }, path: string, init: RequestInit = {}) =>
  testApp(t.db).request(`/api/v1${path}`, as(who, init));

/** A user with an Inbox-only task created through the API. */
async function inboxTask() {
  const me = await makeUser(t.db);
  const ws = await makePersonalWorkspace(t.db, me);
  const id = uuidv7();
  await ok(
    await request(
      me,
      "/inbox/tasks",
      send("POST", {
        clientMutationId: cmid(),
        id,
        workspaceId: ws.id,
        titleInline: content("Plan trip").inline,
        position: "a0",
      }),
    ),
    201,
  );
  return { me, ws, id };
}

const batch = (who: { id: string }, taskId: string, ops: unknown[]) =>
  request(who, `/tasks/${taskId}/blocks/batch`, send("POST", { clientMutationId: cmid(), ops }));

describe("the body page of a task in no list", () => {
  it("edits the body and subtasks through the batch and reads them back", async () => {
    const { me, id } = await inboxTask();
    const note = uuidv7();
    const subBlock = uuidv7();
    const subId = uuidv7();
    const subSubBlock = uuidv7();
    const subSubId = uuidv7();
    const result = blockBatchResultSchema.parse(
      await ok(
        await batch(me, id, [
          { op: "upsert", id: note, type: "paragraph", position: "a0", content: content("Notes") },
          {
            op: "upsert",
            id: subBlock,
            type: "task",
            position: "a1",
            content: content("Book hotel"),
            task: { id: subId },
          },
          {
            op: "upsert",
            id: subSubBlock,
            type: "task",
            position: "a0",
            content: content("Compare prices"),
            task: { id: subSubId },
            container: { type: "task", id: subId },
          },
        ]),
      ),
    );
    expect(result.blocks.map((b) => b.rootListId)).toEqual([null, null, null]);
    expect(result.blocks[0]).toMatchObject({ containerType: "task", containerId: id });

    const [sub] = await t.db.select().from(tasks).where(eq(tasks.id, subId));
    expect(sub).toMatchObject({ parentTaskId: id, listId: null, rootListId: null });

    const page = taskPageSchema.parse(await ok(await request(me, `/tasks/${id}/page`)));
    expect(page.taskId).toBe(id);
    expect(page.items.map((b) => b.id).sort()).toEqual([note, subBlock, subSubBlock].sort());
    // A subtask answers its top task's page.
    const viaSub = taskPageSchema.parse(await ok(await request(me, `/tasks/${subSubId}/page`)));
    expect(viaSub.taskId).toBe(id);

    // Subtasks show under the Inbox item, with their positions.
    const inbox = inboxPageSchema.parse(await ok(await request(me, "/inbox")));
    expect(inbox.tasks.map((x) => x.id).sort()).toEqual([id, subId, subSubId].sort());
    expect(inbox.positions[subId]).toBe("a1");

    // Block events go to the owner's user channel (there is no list channel).
    const sent = (await t.db.select().from(outbox))
      .map((r) => ({ channels: r.channels, e: changeEventSchema.parse(r.event) }))
      .filter((x) => x.e.entity === "block" && x.e.id === note);
    expect(sent[0]?.channels).toEqual([channel.user(me.id)]);
  });

  it("refuses list containers, sublists, subtask pages and strangers", async () => {
    const { me, id } = await inboxTask();
    const stranger = await makeUser(t.db);
    const list = await makeList(t.db, stranger);
    const intoList = await batch(me, id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "paragraph",
        position: "a0",
        content: content("x"),
        container: { type: "list", id: list.id },
      },
    ]);
    expect(await code(intoList)).toBe("VALIDATION");
    const sublist = await batch(me, id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "sublist",
        position: "a0",
        content: {},
        sublist: { id: uuidv7(), title: "Nope" },
      },
    ]);
    expect(await code(sublist)).toBe("VALIDATION");

    const subId = uuidv7();
    await ok(
      await batch(me, id, [
        {
          op: "upsert",
          id: uuidv7(),
          type: "task",
          position: "a0",
          content: content("Sub"),
          task: { id: subId },
        },
      ]),
    );
    expect(await code(await batch(me, subId, [{ op: "delete", id: uuidv7() }]))).toBe("CONFLICT");

    expect(await code(await request(stranger, `/tasks/${id}/page`))).toBe("NOT_FOUND");
    expect(
      await code(
        await batch(stranger, id, [
          { op: "upsert", id: uuidv7(), type: "paragraph", position: "a0", content: content("x") },
        ]),
      ),
    ).toBe("NOT_FOUND");
  });

  it("points list tasks at their list page", async () => {
    const me = await makeUser(t.db);
    const list = await makeList(t.db, me);
    const taskId = uuidv7();
    await ok(
      await request(
        me,
        `/lists/${list.id}/blocks/batch`,
        send("POST", {
          clientMutationId: cmid(),
          ops: [
            {
              op: "upsert",
              id: uuidv7(),
              type: "task",
              position: "a0",
              content: content("In a list"),
              task: { id: taskId },
            },
          ],
        }),
      ),
    );
    expect(await code(await request(me, `/tasks/${taskId}/page`))).toBe("CONFLICT");
    expect(
      await code(
        await request(me, `/tasks/${taskId}`, send("DELETE", { clientMutationId: cmid() })),
      ),
    ).toBe("CONFLICT");
  });
});

describe("DELETE /tasks/:id and restore", () => {
  it("trashes the task with its body and subtasks, and undo brings them back", async () => {
    const { me, id } = await inboxTask();
    const subId = uuidv7();
    const noteId = uuidv7();
    await ok(
      await batch(me, id, [
        { op: "upsert", id: noteId, type: "paragraph", position: "a0", content: content("n") },
        {
          op: "upsert",
          id: uuidv7(),
          type: "task",
          position: "a1",
          content: content("Sub"),
          task: { id: subId },
        },
      ]),
    );
    const del = (await ok(
      await request(me, `/tasks/${id}`, send("DELETE", { clientMutationId: cmid() })),
    )) as { deleted: string[] };
    expect(del.deleted.sort()).toEqual([id, subId].sort());
    expect(inboxPageSchema.parse(await ok(await request(me, "/inbox"))).items).toEqual([]);
    const [note] = await t.db.select().from(blocks).where(eq(blocks.id, noteId));
    expect(note?.trashRootId).toBe(id);
    expect(await code(await request(me, `/tasks/${id}`))).toBe("NOT_FOUND");

    const stranger = await makeUser(t.db);
    expect(
      await code(
        await request(stranger, `/tasks/${id}/restore`, send("POST", { clientMutationId: cmid() })),
      ),
    ).toBe("NOT_FOUND");

    await ok(await request(me, `/tasks/${id}/restore`, send("POST", { clientMutationId: cmid() })));
    const inbox = inboxPageSchema.parse(await ok(await request(me, "/inbox")));
    expect(inbox.items.map((i) => i.taskId)).toEqual([id]);
    expect(inbox.tasks.map((x) => x.id).sort()).toEqual([id, subId].sort());
    const page = taskPageSchema.parse(await ok(await request(me, `/tasks/${id}/page`)));
    expect(page.items.map((b) => b.id)).toContain(noteId);
  });
});

describe("POST /tasks/:id/move", () => {
  async function listWithTask(title = "In a list") {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const list = await makeList(t.db, me, { workspaceId: ws.id, title: "Groceries" });
    const taskId = uuidv7();
    const blockId = uuidv7();
    const subId = uuidv7();
    await ok(
      await request(
        me,
        `/lists/${list.id}/blocks/batch`,
        send("POST", {
          clientMutationId: cmid(),
          ops: [
            {
              op: "upsert",
              id: blockId,
              type: "task",
              position: "a0",
              content: content(title),
              task: { id: taskId },
            },
            {
              op: "upsert",
              id: uuidv7(),
              type: "task",
              position: "a0",
              content: content("Sub"),
              task: { id: subId },
              container: { type: "task", id: taskId },
            },
          ],
        }),
      ),
    );
    return { me, ws, list, taskId, blockId, subId };
  }

  const move = (who: { id: string }, id: string, listId: string | null) =>
    request(who, `/tasks/${id}/move`, send("POST", { clientMutationId: cmid(), listId }));

  it("Remove from list: the task and its subtree leave for the Inbox, the block goes", async () => {
    const { me, list, taskId, blockId, subId } = await listWithTask();
    await ok(await move(me, taskId, null));
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row).toMatchObject({ listId: null, rootListId: null, parentTaskId: null });
    const [sub] = await t.db.select().from(tasks).where(eq(tasks.id, subId));
    expect(sub).toMatchObject({ listId: null, parentTaskId: taskId });
    expect(await t.db.select().from(blocks).where(eq(blocks.id, blockId))).toEqual([]);
    const listBlocks = await ok(await request(me, `/lists/${list.id}/blocks`));
    expect((listBlocks as { items: unknown[] }).items).toEqual([]);
    const inbox = inboxPageSchema.parse(await ok(await request(me, "/inbox")));
    expect(inbox.items.map((i) => i.taskId)).toEqual([taskId]);
    expect(inbox.tasks.map((x) => x.id).sort()).toEqual([taskId, subId].sort());
    const page = taskPageSchema.parse(await ok(await request(me, `/tasks/${taskId}/page`)));
    expect(page.items.map((b) => b.rootListId)).toEqual([null]);
  });

  it("moves a task in no list onto a list's end, out of the Inbox, and back again", async () => {
    const { me, list, taskId } = await listWithTask("Stays");
    const { id: inboxOnly } = await (async () => {
      const id = uuidv7();
      const ws = (await t.db.select().from(tasks).where(eq(tasks.id, taskId)))[0]?.workspaceId;
      await ok(
        await request(
          me,
          "/inbox/tasks",
          send("POST", {
            clientMutationId: cmid(),
            id,
            workspaceId: ws,
            titleInline: content("Loose").inline,
            position: "a0",
          }),
        ),
        201,
      );
      return { id };
    })();
    const body = (await ok(await move(me, inboxOnly, list.id))) as { blockId: string };
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, inboxOnly));
    expect(row).toMatchObject({ listId: list.id, rootListId: list.id });
    const items = (await ok(await request(me, `/lists/${list.id}/blocks`))) as {
      items: { id: string; taskId: string | null; position: string }[];
    };
    const last = items.items.filter((b) => b.taskId).at(-1);
    expect(last).toMatchObject({ id: body.blockId, taskId: inboxOnly });
    expect(inboxPageSchema.parse(await ok(await request(me, "/inbox"))).items).toEqual([]);
    // And back out again: no unique clash on the block.
    await ok(await move(me, inboxOnly, null));
    await ok(await move(me, inboxOnly, list.id));
  });

  it("refuses the wrong direction, other people's lists and tasks", async () => {
    const { me, list, taskId } = await listWithTask();
    const other = await makeUser(t.db);
    const theirs = await makeList(t.db, other);
    expect(await code(await move(me, taskId, list.id))).toBe("CONFLICT");
    expect(await code(await move(other, taskId, null))).toBe("NOT_FOUND");
    await ok(await move(me, taskId, null));
    expect(await code(await move(me, taskId, null))).toBe("CONFLICT");
    expect(await code(await move(me, taskId, theirs.id))).toBe("NOT_FOUND");
  });
});
