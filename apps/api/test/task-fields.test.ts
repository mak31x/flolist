import { activityEvents, labels, outbox, user as users } from "@flolist/db";
import {
  apiErrorSchema,
  blockBatchResultSchema,
  blockPageSchema,
  changeEventSchema,
  duplicateListResultSchema,
  taskSchema,
  uuidv7,
  type BlockOp,
  type ChangeEvent,
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
const text = (s: string) => ({ inline: [{ type: "text", text: s }] });

async function setup() {
  const me = await makeUser(t.db);
  await t.db.update(users).set({ timezone: "Asia/Kolkata" }).where(eq(users.id, me.id));
  const ws = await makePersonalWorkspace(t.db, me);
  const list = await makeList(t.db, me, { workspaceId: ws.id, title: "Home" });
  return { me, ws, list };
}

async function ok(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

const batch = (who: { id: string }, listId: string, ops: (BlockOp | Record<string, unknown>)[]) =>
  testApp(t.db).request(
    `/api/v1/lists/${listId}/blocks/batch`,
    as(who, send("POST", { clientMutationId: cmid(), ops })),
  );

const patch = (who: { id: string }, taskId: string, body: Record<string, unknown>) =>
  testApp(t.db).request(
    `/api/v1/tasks/${taskId}`,
    as(who, send("PATCH", { clientMutationId: cmid(), ...body })),
  );

async function newTask(who: { id: string }, listId: string, task: Record<string, unknown> = {}) {
  const blockId = uuidv7();
  const taskId = uuidv7();
  const result = blockBatchResultSchema.parse(
    await ok(
      await batch(who, listId, [
        {
          op: "upsert",
          id: blockId,
          type: "task",
          position: "a0",
          content: text("Pay rent"),
          task: { id: taskId, ...task },
        },
      ]),
    ),
  );
  return { blockId, taskId, block: result.blocks.find((b) => b.id === blockId) };
}

async function makeLabel(workspaceId: string, name: string) {
  const [row] = await t.db.insert(labels).values({ workspaceId, name }).returning();
  if (!row) throw new Error("label");
  return row;
}

async function actions(taskId: string) {
  return t.db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.entityId, taskId))
    .orderBy(asc(activityEvents.createdAt), asc(activityEvents.id));
}

describe("due dates", () => {
  it("sets a due date through the block batch, defaulting the zone to the profile's", async () => {
    const { me, list } = await setup();
    const { taskId, block } = await newTask(me, list.id, {
      due: { date: "2026-11-28", time: "17:00" },
    });
    expect(block?.task?.due).toEqual({ date: "2026-11-28", time: "17:00", tz: "Asia/Kolkata" });
    const task = taskSchema.parse(
      await ok(await testApp(t.db).request(`/api/v1/tasks/${taskId}`, as(me))),
    );
    expect(task.due).toEqual({ date: "2026-11-28", time: "17:00", tz: "Asia/Kolkata" });
    const log = await actions(taskId);
    expect(log.map((a) => a.action)).toEqual(["created", "due_changed"]);
    expect(log[1]?.new).toEqual({ date: "2026-11-28", time: "17:00", tz: "Asia/Kolkata" });
  });

  it("changes and clears the date with PATCH, keeping the block in step", async () => {
    const { me, list } = await setup();
    const { blockId, taskId } = await newTask(me, list.id);
    const first = taskSchema.parse(
      await ok(await patch(me, taskId, { due: { date: "2026-12-01", tz: "Europe/Berlin" } })),
    );
    expect(first.due).toEqual({ date: "2026-12-01", time: null, tz: "Europe/Berlin" });
    const page = blockPageSchema.parse(
      await ok(await testApp(t.db).request(`/api/v1/lists/${list.id}/blocks`, as(me))),
    );
    const row = page.items.find((b) => b.id === blockId);
    expect(row?.task?.due?.date).toBe("2026-12-01");

    // The same value again is not a change.
    const again = taskSchema.parse(
      await ok(await patch(me, taskId, { due: { date: "2026-12-01", tz: "Europe/Berlin" } })),
    );
    expect(again.version).toBe(first.version);

    const cleared = taskSchema.parse(await ok(await patch(me, taskId, { due: null })));
    expect(cleared.due).toBeNull();
    const dueLog = (await actions(taskId)).filter((a) => a.action === "due_changed");
    expect(dueLog.map((a) => a.new)).toEqual([
      { date: "2026-12-01", time: null, tz: "Europe/Berlin" },
      null,
    ]);
  });

  it("refuses malformed dates and times", async () => {
    const { me, list } = await setup();
    const { taskId } = await newTask(me, list.id);
    for (const due of [
      { date: "2026-13-01" },
      { date: "2026-11-28", time: "5pm" },
      { date: "2026-11-28", tz: "Nowhere/City" },
    ]) {
      const res = await patch(me, taskId, { due });
      expect(res.status).toBe(400);
    }
  });
});

describe("priority", () => {
  it("sets and logs priority", async () => {
    const { me, list } = await setup();
    const { taskId } = await newTask(me, list.id);
    const res = taskSchema.parse(await ok(await patch(me, taskId, { priority: 3 })));
    expect(res.priority).toBe(3);
    const log = (await actions(taskId)).filter((a) => a.action === "priority_changed");
    expect(log.map((a) => [a.old, a.new])).toEqual([[0, 3]]);
    expect((await patch(me, taskId, { priority: 4 })).status).toBe(400);
  });
});

describe("task labels", () => {
  it("adds, keeps the order of and removes labels, logging names", async () => {
    const { me, ws, list } = await setup();
    const home = await makeLabel(ws.id, "Home");
    const bills = await makeLabel(ws.id, "Bills");
    const { taskId } = await newTask(me, list.id, { labelIds: [bills.id] });
    const both = taskSchema.parse(
      await ok(await patch(me, taskId, { labelIds: [home.id, bills.id] })),
    );
    // Labels already on the task keep their place; new ones go to the end.
    expect(both.labelIds).toEqual([bills.id, home.id]);
    const one = taskSchema.parse(await ok(await patch(me, taskId, { labelIds: [home.id] })));
    expect(one.labelIds).toEqual([home.id]);
    const log = (await actions(taskId)).filter((a) => a.action === "labels_changed");
    expect(log.map((a) => [a.old, a.new])).toEqual([
      [[], ["Bills"]],
      [["Bills"], ["Bills", "Home"]],
      [["Bills", "Home"], ["Home"]],
    ]);
  });

  it("refuses labels of another workspace or that don't exist", async () => {
    const { me, list } = await setup();
    const other = await makeUser(t.db);
    const otherWs = await makePersonalWorkspace(t.db, other);
    const foreign = await makeLabel(otherWs.id, "Secret");
    const { taskId } = await newTask(me, list.id);
    for (const id of [foreign.id, uuidv7()]) {
      const res = await patch(me, taskId, { labelIds: [id] });
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(await res.json()).error.code).toBe("NOT_FOUND");
    }
  });

  it("emits task and block events with the new fields", async () => {
    const { me, ws, list } = await setup();
    const label = await makeLabel(ws.id, "Errands");
    const { taskId, blockId } = await newTask(me, list.id);
    const mutation = cmid();
    await ok(
      await testApp(t.db).request(
        `/api/v1/tasks/${taskId}`,
        as(
          me,
          send("PATCH", {
            clientMutationId: mutation,
            priority: 2,
            labelIds: [label.id],
            due: { date: "2026-11-30" },
          }),
        ),
      ),
    );
    const events = (await t.db.select().from(outbox))
      .map((r) => changeEventSchema.parse(r.event))
      .filter((e) => e.clientMutationId === mutation);
    const blockEvent = events.find(
      (e): e is Extract<ChangeEvent, { entity: "block"; op: "upsert" }> =>
        e.entity === "block" && e.op === "upsert" && e.id === blockId,
    );
    const taskEvent = events.find(
      (e): e is Extract<ChangeEvent, { entity: "task"; op: "upsert" }> =>
        e.entity === "task" && e.op === "upsert" && e.id === taskId,
    );
    expect(blockEvent?.data.task).toMatchObject({
      priority: 2,
      labelIds: [label.id],
      due: { date: "2026-11-30", time: null, tz: "Asia/Kolkata" },
    });
    expect(taskEvent?.data.labelIds).toEqual([label.id]);
  });

  it("keeps fields when a list is duplicated", async () => {
    const { me, ws, list } = await setup();
    const label = await makeLabel(ws.id, "Copy me");
    const { taskId } = await newTask(me, list.id, {
      priority: 1,
      labelIds: [label.id],
      due: { date: "2026-12-24", time: "09:30" },
    });
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
    const page = blockPageSchema.parse(
      await ok(await testApp(t.db).request(`/api/v1/lists/${copyId}/blocks`, as(me))),
    );
    const copied = page.items.find((b) => b.taskId && b.taskId !== taskId);
    expect(copied?.task).toMatchObject({
      priority: 1,
      labelIds: [label.id],
      due: { date: "2026-12-24", time: "09:30", tz: "Asia/Kolkata" },
    });
  });
});
