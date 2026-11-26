import { activityEvents, blocks, outbox, tasks } from "@flolist/db";
import {
  apiErrorSchema,
  blockBatchResultSchema,
  blockPageSchema,
  changeEventSchema,
  activityPageSchema,
  duplicateListResultSchema,
  MAX_SUBTASK_DEPTH,
  taskSchema,
  uuidv7,
  type BlockOp,
} from "@flolist/shared";
import { and, asc, eq } from "drizzle-orm";
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
const text = (s: string) => ({ inline: s === "" ? [] : [{ type: "text", text: s }] });

async function setup() {
  const me = await makeUser(t.db);
  const ws = await makePersonalWorkspace(t.db, me);
  const list = await makeList(t.db, me, { workspaceId: ws.id, title: "Trip" });
  return { me, ws, list };
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

async function taskRow(id: string) {
  const [row] = await t.db.select().from(tasks).where(eq(tasks.id, id));
  return row;
}

async function activity(taskId: string) {
  return t.db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.entityId, taskId))
    .orderBy(asc(activityEvents.createdAt), asc(activityEvents.id));
}

/** Creates a task block (optionally inside another task) and returns its ids. */
async function newTask(
  who: { id: string },
  listId: string,
  title: string,
  opts: { position?: string; parent?: string } = {},
) {
  const blockId = uuidv7();
  const taskId = uuidv7();
  await ok(
    await batch(who, listId, [
      {
        op: "upsert",
        id: blockId,
        type: "task",
        position: opts.position ?? "a0",
        content: text(title),
        task: { id: taskId },
        ...(opts.parent ? { container: { type: "task", id: opts.parent } } : {}),
      },
    ]),
  );
  return { blockId, taskId };
}

describe("task blocks", () => {
  it("creates the task with the block and shows its state", async () => {
    const { me, ws, list } = await setup();
    const blockId = uuidv7();
    const taskId = uuidv7();
    const result = blockBatchResultSchema.parse(
      await ok(
        await batch(me, list.id, [
          {
            op: "upsert",
            id: blockId,
            type: "task",
            position: "a0",
            content: text("Book flights"),
            task: { id: taskId },
          },
        ]),
      ),
    );
    expect(result.blocks[0]).toMatchObject({
      id: blockId,
      type: "task",
      taskId,
      task: { completedAt: null, completedBy: null },
    });
    expect(await taskRow(taskId)).toMatchObject({
      workspaceId: ws.id,
      listId: list.id,
      rootListId: list.id,
      parentTaskId: null,
      title: "Book flights",
      createdBy: me.id,
    });
    expect((await activity(taskId)).map((a) => a.action)).toEqual(["created"]);

    // Live events: the block and the task.
    const events = (await t.db.select().from(outbox)).map((r) => changeEventSchema.parse(r.event));
    expect(events.some((e) => e.entity === "task" && e.id === taskId)).toBe(true);
  });

  it("needs a task id, and only task blocks take one", async () => {
    const { me, list } = await setup();
    const missing = await batch(me, list.id, [
      { op: "upsert", id: uuidv7(), type: "task", position: "a0", content: text("x") },
    ]);
    expect(missing.status).toBe(400);
    const wrong = await batch(me, list.id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "paragraph",
        position: "a0",
        task: { id: uuidv7() },
      },
    ]);
    expect(wrong.status).toBe(400);
  });

  it("refuses an over-long title", async () => {
    const { me, list } = await setup();
    const res = await batch(me, list.id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "task",
        position: "a0",
        content: text("x".repeat(2001)),
        task: { id: uuidv7() },
      },
    ]);
    expect(res.status).toBe(400);
  });

  it("completes and reopens, logging each, and renames with merged entries", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id, "Pack");

    const done = blockBatchResultSchema.parse(
      await ok(
        await batch(me, list.id, [{ op: "upsert", id: blockId, task: { completed: true } }]),
      ),
    );
    expect(done.blocks[0]?.task?.completedBy).toBe(me.id);
    expect((await taskRow(taskId))?.completedAt).not.toBeNull();

    await ok(await batch(me, list.id, [{ op: "upsert", id: blockId, task: { completed: false } }]));
    expect((await taskRow(taskId))?.completedAt).toBeNull();

    await ok(await batch(me, list.id, [{ op: "upsert", id: blockId, content: text("Pack bags") }]));
    await ok(
      await batch(me, list.id, [{ op: "upsert", id: blockId, content: text("Pack the bags") }]),
    );
    expect((await taskRow(taskId))?.title).toBe("Pack the bags");
    const log = await activity(taskId);
    expect(log.map((a) => a.action)).toEqual(["created", "completed", "reopened", "title_changed"]);
    expect(log[3]).toMatchObject({ old: "Pack", new: "Pack the bags" });
  });

  it("merges title edits into the creation entry while it's fresh", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id, "");
    await ok(await batch(me, list.id, [{ op: "upsert", id: blockId, content: text("Call mum") }]));
    const log = await activity(taskId);
    expect(log.map((a) => a.action)).toEqual(["created"]);
    expect(log[0]?.new).toBe("Call mum");
  });

  it("turns a paragraph into a task and back; undo restores the same task", async () => {
    const { me, list } = await setup();
    const blockId = uuidv7();
    const taskId = uuidv7();
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: blockId, type: "paragraph", position: "a0", content: text("Milk") },
      ]),
    );
    await ok(
      await batch(me, list.id, [{ op: "upsert", id: blockId, type: "task", task: { id: taskId } }]),
    );
    expect((await taskRow(taskId))?.title).toBe("Milk");

    const back = blockBatchResultSchema.parse(
      await ok(await batch(me, list.id, [{ op: "upsert", id: blockId, type: "paragraph" }])),
    );
    expect(back.blocks[0]).toMatchObject({ type: "paragraph", taskId: null, task: null });
    expect((await taskRow(taskId))?.deletedAt).not.toBeNull();

    await ok(
      await batch(me, list.id, [{ op: "upsert", id: blockId, type: "task", task: { id: taskId } }]),
    );
    const row = await taskRow(taskId);
    expect(row?.deletedAt).toBeNull();
    expect(row?.trashRootId).toBeNull();
  });
});

describe("subtasks", () => {
  it("creates subtasks in a task's body; the page returns them", async () => {
    const { me, list } = await setup();
    const parent = await newTask(me, list.id, "Plan");
    const child = await newTask(me, list.id, "Book hotel", { parent: parent.taskId });
    expect(await taskRow(child.taskId)).toMatchObject({
      listId: list.id,
      parentTaskId: parent.taskId,
    });
    const page = await blocksOf(me, list.id);
    expect(page.find((b) => b.id === child.blockId)).toMatchObject({
      containerType: "task",
      containerId: parent.taskId,
    });
  });

  it("refuses a container that isn't a task of this list", async () => {
    const { me, ws, list } = await setup();
    const other = await makeList(t.db, me, { workspaceId: ws.id, title: "Other" });
    const foreign = await newTask(me, other.id, "Elsewhere");
    const res = await batch(me, list.id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "task",
        position: "a0",
        task: { id: uuidv7() },
        container: { type: "task", id: foreign.taskId },
      },
    ]);
    expect(res.status).toBe(400);
  });

  it("refuses sublists inside a task", async () => {
    const { me, list } = await setup();
    const parent = await newTask(me, list.id, "Plan");
    const res = await batch(me, list.id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "sublist",
        position: "a0",
        sublist: { id: uuidv7(), title: "x" },
        container: { type: "task", id: parent.taskId },
      },
    ]);
    expect(res.status).toBe(400);
  });

  it("Tab moves a task into the one above; Shift+Tab moves it out", async () => {
    const { me, list } = await setup();
    const a = await newTask(me, list.id, "A", { position: "a0" });
    const b = await newTask(me, list.id, "B", { position: "a1" });
    await ok(
      await batch(me, list.id, [
        { op: "move", id: b.blockId, position: "a0", container: { type: "task", id: a.taskId } },
      ]),
    );
    expect((await taskRow(b.taskId))?.parentTaskId).toBe(a.taskId);
    await ok(
      await batch(me, list.id, [
        { op: "move", id: b.blockId, position: "a1", container: { type: "list", id: list.id } },
      ]),
    );
    expect((await taskRow(b.taskId))?.parentTaskId).toBeNull();
  });

  it("an upsert can change the container too", async () => {
    const { me, list } = await setup();
    const a = await newTask(me, list.id, "A", { position: "a0" });
    const b = await newTask(me, list.id, "B", { position: "a1" });
    await ok(
      await batch(me, list.id, [
        { op: "upsert", id: b.blockId, position: "a0", container: { type: "task", id: a.taskId } },
      ]),
    );
    expect((await taskRow(b.taskId))?.parentTaskId).toBe(a.taskId);
  });

  it("refuses moving a task into itself or its subtasks, or too deep", async () => {
    const { me, list } = await setup();
    const a = await newTask(me, list.id, "A");
    const b = await newTask(me, list.id, "B", { parent: a.taskId });
    const cycle = await batch(me, list.id, [
      { op: "move", id: a.blockId, position: "a0", container: { type: "task", id: b.taskId } },
    ]);
    expect(cycle.status).toBe(400);

    let parent = b.taskId;
    for (let depth = 3; depth <= MAX_SUBTASK_DEPTH; depth++) {
      parent = (await newTask(me, list.id, `L${String(depth)}`, { parent })).taskId;
    }
    const tooDeep = await batch(me, list.id, [
      {
        op: "upsert",
        id: uuidv7(),
        type: "task",
        position: "a0",
        task: { id: uuidv7() },
        container: { type: "task", id: parent },
      },
    ]);
    expect(tooDeep.status).toBe(400);
  });

  it("deleting a parent trashes its subtasks and body; undo restores them", async () => {
    const { me, list } = await setup();
    const parent = await newTask(me, list.id, "Plan");
    const child = await newTask(me, list.id, "Book", { parent: parent.taskId });
    const note = uuidv7();
    await ok(
      await batch(me, list.id, [
        {
          op: "upsert",
          id: note,
          type: "paragraph",
          position: "a1",
          content: text("notes"),
          container: { type: "task", id: parent.taskId },
        },
      ]),
    );

    const del = blockBatchResultSchema.parse(
      await ok(await batch(me, list.id, [{ op: "delete", id: parent.blockId }])),
    );
    expect(new Set(del.deleted)).toEqual(new Set([parent.blockId, child.blockId, note]));
    expect((await taskRow(child.taskId))?.trashRootId).toBe(parent.blockId);
    expect(await blocksOf(me, list.id)).toEqual([]);

    const undo = blockBatchResultSchema.parse(
      await ok(await batch(me, list.id, [{ op: "upsert", id: parent.blockId }])),
    );
    expect(new Set(undo.blocks.map((b) => b.id))).toEqual(
      new Set([parent.blockId, child.blockId, note]),
    );
    expect((await taskRow(child.taskId))?.deletedAt).toBeNull();
    expect((await blocksOf(me, list.id)).length).toBe(3);
    expect((await activity(parent.taskId)).map((a) => a.action)).toContain("restored");
  });

  it("a delete of parent and child in one batch still restores together", async () => {
    const { me, list } = await setup();
    const parent = await newTask(me, list.id, "Plan");
    const child = await newTask(me, list.id, "Book", { parent: parent.taskId });
    await ok(
      await batch(me, list.id, [
        { op: "delete", id: parent.blockId },
        { op: "delete", id: child.blockId },
      ]),
    );
    const [row] = await t.db.select().from(blocks).where(eq(blocks.id, child.blockId));
    expect(row?.trashRootId).toBe(parent.blockId);
  });
});

describe("tasks across lists", () => {
  it("move-to takes tasks and their bodies to the target", async () => {
    const { me, ws, list } = await setup();
    const target = await makeList(t.db, me, { workspaceId: ws.id, title: "Target" });
    const parent = await newTask(me, list.id, "Plan");
    const child = await newTask(me, list.id, "Book", { parent: parent.taskId });
    await ok(
      await testApp(t.db).request(
        `/api/v1/lists/${list.id}/blocks/move-to`,
        as(
          me,
          send("POST", {
            clientMutationId: cmid(),
            ids: [parent.blockId],
            targetListId: target.id,
          }),
        ),
      ),
    );
    expect(await taskRow(parent.taskId)).toMatchObject({
      listId: target.id,
      rootListId: target.id,
    });
    expect(await taskRow(child.taskId)).toMatchObject({ listId: target.id, rootListId: target.id });
    const ids = (await blocksOf(me, target.id)).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([parent.blockId, child.blockId]));
    expect(await blocksOf(me, list.id)).toEqual([]);
  });

  it("duplicating a list copies its tasks, subtasks and completion", async () => {
    const { me, list } = await setup();
    const parent = await newTask(me, list.id, "Plan");
    await newTask(me, list.id, "Book", { parent: parent.taskId });
    await ok(
      await batch(me, list.id, [{ op: "upsert", id: parent.blockId, task: { completed: true } }]),
    );
    const copyId = uuidv7();
    duplicateListResultSchema.parse(
      await ok(
        await testApp(t.db).request(
          `/api/v1/lists/${list.id}/duplicate`,
          as(me, send("POST", { clientMutationId: cmid(), id: copyId })),
        ),
        201,
      ),
    );
    const copied = await blocksOf(me, copyId);
    expect(copied).toHaveLength(2);
    const top = copied.find((b) => b.containerType === "list");
    expect(top?.task?.completedAt).not.toBeNull();
    expect(top?.taskId).not.toBe(parent.taskId);
    const sub = copied.find((b) => b.containerType === "task");
    expect(sub?.containerId).toBe(top?.taskId);
    const copiedTasks = await t.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.listId, copyId)));
    expect(copiedTasks).toHaveLength(2);
  });

  it("another user can't touch the list's tasks", async () => {
    const { me, list } = await setup();
    const { blockId } = await newTask(me, list.id, "Mine");
    const stranger = await makeUser(t.db);
    const res = await batch(stranger, list.id, [
      { op: "upsert", id: blockId, task: { completed: true } },
    ]);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });
});

describe("task routes", () => {
  const app = () => testApp(t.db);

  it("GET /tasks/:id returns the task with its block", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id, "Pack");
    const task = taskSchema.parse(await ok(await app().request(`/api/v1/tasks/${taskId}`, as(me))));
    expect(task).toMatchObject({ id: taskId, blockId, title: "Pack", listId: list.id });
  });

  it("PATCH /tasks/:id changes title and completion and keeps the block in step", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id, "Pack");
    const res = await app().request(
      `/api/v1/tasks/${taskId}`,
      as(
        me,
        send("PATCH", {
          clientMutationId: cmid(),
          titleInline: text("Pack bags").inline,
          completed: true,
        }),
      ),
    );
    const task = taskSchema.parse(await ok(res));
    expect(task.title).toBe("Pack bags");
    expect(task.completedBy).toBe(me.id);
    const block = (await blocksOf(me, list.id)).find((b) => b.id === blockId);
    expect(block?.content).toEqual(text("Pack bags"));
    expect(block?.task?.completedAt).not.toBeNull();
  });

  it("GET /tasks/:id/activity lists entries oldest first with the actor", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id, "Pack");
    await ok(await batch(me, list.id, [{ op: "upsert", id: blockId, task: { completed: true } }]));
    const page = activityPageSchema.parse(
      await ok(await app().request(`/api/v1/tasks/${taskId}/activity`, as(me))),
    );
    expect(page.items.map((i) => i.action)).toEqual(["created", "completed"]);
    expect(page.items[0]?.actor).toMatchObject({
      id: me.id,
      name: expect.stringMatching(/^User /) as unknown,
    });
  });

  it("hides tasks from other users and deleted tasks (404)", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id, "Mine");
    const stranger = await makeUser(t.db);
    for (const path of [`/api/v1/tasks/${taskId}`, `/api/v1/tasks/${taskId}/activity`]) {
      const res = await app().request(path, as(stranger));
      expect(res.status).toBe(404);
    }
    const patch = await app().request(
      `/api/v1/tasks/${taskId}`,
      as(stranger, send("PATCH", { clientMutationId: cmid(), completed: true })),
    );
    expect(patch.status).toBe(404);

    await ok(await batch(me, list.id, [{ op: "delete", id: blockId }]));
    expect((await app().request(`/api/v1/tasks/${taskId}`, as(me))).status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const res = await app().request(`/api/v1/tasks/${uuidv7()}`);
    expect(res.status).toBe(401);
  });
});
