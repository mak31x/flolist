import { activityEvents, inboxItems, outbox, tasks } from "@flolist/db";
import {
  apiErrorSchema,
  channel,
  changeEventSchema,
  inboxItemSchema,
  inboxPageSchema,
  taskSchema,
  uuidv7,
} from "@flolist/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import {
  addMember,
  as,
  makeInboxOnlyTask,
  makeList,
  makePersonalWorkspace,
  makeTeam,
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
const inline = (s: string) => [{ type: "text", text: s }];

async function ok(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

async function errorCode(res: Response) {
  return apiErrorSchema.parse(await res.json()).error.code;
}

const request = (who: { id: string }, path: string, init: RequestInit = {}) =>
  testApp(t.db).request(`/api/v1${path}`, as(who, init));

async function inbox(who: { id: string }) {
  return inboxPageSchema.parse(await ok(await request(who, "/inbox")));
}

async function createInboxTask(
  who: { id: string },
  workspaceId: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  const id = uuidv7();
  const res = await request(
    who,
    "/inbox/tasks",
    send("POST", {
      clientMutationId: cmid(),
      id,
      workspaceId,
      titleInline: inline(title),
      position: "a0",
      ...extra,
    }),
  );
  return { id, res };
}

/** A list task created through the block batch (the editor's path). */
async function listTask(who: { id: string }, listId: string, title: string) {
  const taskId = uuidv7();
  await ok(
    await request(
      who,
      `/lists/${listId}/blocks/batch`,
      send("POST", {
        clientMutationId: cmid(),
        ops: [
          {
            op: "upsert",
            id: uuidv7(),
            type: "task",
            position: "a0",
            content: { inline: inline(title) },
            task: { id: taskId },
          },
        ],
      }),
    ),
  );
  return taskId;
}

async function events() {
  const rows = await t.db.select().from(outbox);
  return rows.map((r) => ({ channels: r.channels, event: changeEventSchema.parse(r.event) }));
}

describe("POST /inbox/tasks", () => {
  it("creates a task in no list and puts it in the caller's Inbox", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const { id, res } = await createInboxTask(me, ws.id, "Call the bank", {
      priority: 3,
      due: { date: "2026-12-01", time: null, tz: "Europe/Berlin" },
    });
    const body = (await ok(res, 201)) as { task: unknown; item: unknown };
    expect(taskSchema.parse(body.task)).toMatchObject({
      id,
      listId: null,
      rootListId: null,
      title: "Call the bank",
      priority: 3,
      due: { date: "2026-12-01", time: null, tz: "Europe/Berlin" },
    });
    expect(inboxItemSchema.parse(body.item)).toMatchObject({ taskId: id, reason: "manual" });

    const page = await inbox(me);
    expect(page.items.map((i) => i.taskId)).toEqual([id]);
    expect(page.tasks.map((x) => x.id)).toEqual([id]);

    const actions = await t.db
      .select({ action: activityEvents.action })
      .from(activityEvents)
      .where(eq(activityEvents.entityId, id));
    expect(actions.map((a) => a.action)).toContain("created");

    // The task and the item reach the creator's user channel.
    const sent = (await events()).filter((e) => e.event.id === id);
    expect(sent.find((e) => e.event.entity === "task")?.channels).toContain(channel.user(me.id));
    expect(sent.find((e) => e.event.entity === "inboxItem")?.channels).toEqual([
      channel.user(me.id),
    ]);
  });

  it("checks workspace.createTask: strangers get 404, team members may", async () => {
    const owner = await makeUser(t.db);
    const mate = await makeUser(t.db);
    const stranger = await makeUser(t.db);
    const personal = await makePersonalWorkspace(t.db, owner);
    const team = await makeTeam(t.db, owner);
    await addMember(t.db, team, mate);
    expect(await errorCode((await createInboxTask(stranger, personal.id, "x")).res)).toBe(
      "NOT_FOUND",
    );
    await ok((await createInboxTask(mate, team.id, "Team errand")).res, 201);
  });

  it("replays a retried create and refuses a reused task id", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const id = uuidv7();
    const body = {
      clientMutationId: cmid(),
      id,
      workspaceId: ws.id,
      titleInline: inline("Once"),
      position: "a0",
    };
    await ok(await request(me, "/inbox/tasks", send("POST", body)), 201);
    await ok(await request(me, "/inbox/tasks", send("POST", body)), 201);
    const again = await request(
      me,
      "/inbox/tasks",
      send("POST", { ...body, clientMutationId: cmid() }),
    );
    expect(await errorCode(again)).toBe("CONFLICT");
    expect(await t.db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(1);
  });
});

describe("PUT and DELETE /inbox/items/:taskId", () => {
  it("adds a list task, orders by position, and removes it", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const list = await makeList(t.db, me, { workspaceId: ws.id });
    const a = await listTask(me, list.id, "From a list");
    const { id: b } = await createInboxTask(me, ws.id, "Inbox only", { position: "a1" });

    await ok(
      await request(
        me,
        `/inbox/items/${a}`,
        send("PUT", { clientMutationId: cmid(), position: "a0" }),
      ),
    );
    expect((await inbox(me)).items.map((i) => i.taskId)).toEqual([a, b]);

    // Moving it is the same call.
    await ok(
      await request(
        me,
        `/inbox/items/${a}`,
        send("PUT", { clientMutationId: cmid(), position: "a5" }),
      ),
    );
    expect((await inbox(me)).items.map((i) => i.taskId)).toEqual([b, a]);

    const removed = await ok(
      await request(me, `/inbox/items/${a}`, send("DELETE", { clientMutationId: cmid() })),
    );
    expect(removed).toEqual({ removed: true });
    expect((await inbox(me)).items.map((i) => i.taskId)).toEqual([b]);
    // The task itself stays in its list.
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, a));
    expect(row?.deletedAt).toBeNull();
    const deletes = (await events()).filter(
      (e) => e.event.entity === "inboxItem" && e.event.op === "delete" && e.event.id === a,
    );
    expect(deletes).toHaveLength(1);
  });

  it("keeps a task in no list in the Inbox", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const { id } = await createInboxTask(me, ws.id, "Nowhere else");
    const res = await request(
      me,
      `/inbox/items/${id}`,
      send("DELETE", { clientMutationId: cmid() }),
    );
    expect(await errorCode(res)).toBe("CONFLICT");
  });

  it("can't add or remove tasks the caller can't see", async () => {
    const owner = await makeUser(t.db);
    const stranger = await makeUser(t.db);
    const list = await makeList(t.db, owner);
    const listTaskId = await listTask(owner, list.id, "Private");
    const inboxOnly = await makeInboxOnlyTask(t.db, owner, { workspaceId: list.workspaceId });
    for (const id of [listTaskId, inboxOnly.id]) {
      const put = await request(
        stranger,
        `/inbox/items/${id}`,
        send("PUT", { clientMutationId: cmid(), position: "a0" }),
      );
      expect(await errorCode(put)).toBe("NOT_FOUND");
      const del = await request(
        stranger,
        `/inbox/items/${id}`,
        send("DELETE", { clientMutationId: cmid() }),
      );
      expect(await errorCode(del)).toBe("NOT_FOUND");
    }
    expect((await inbox(stranger)).items).toEqual([]);
  });

  it("requires a session", async () => {
    const res = await testApp(t.db).request("/api/v1/inbox");
    expect(res.status).toBe(401);
  });
});

describe("GET /inbox", () => {
  it("keeps completed tasks (the view hides them), skips deleted ones and lists subtasks", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const { id: done } = await createInboxTask(me, ws.id, "Done soon");
    const { id: gone } = await createInboxTask(me, ws.id, "Deleted");
    const parent = await makeInboxOnlyTask(t.db, me, { workspaceId: ws.id, title: "Parent" });
    const sub = await makeInboxOnlyTask(t.db, me, {
      workspaceId: ws.id,
      title: "Sub",
      parentTaskId: parent.id,
    });
    await ok(
      await request(
        me,
        `/inbox/items/${parent.id}`,
        send("PUT", { clientMutationId: cmid(), position: "a9" }),
      ),
    );
    await ok(
      await request(
        me,
        `/tasks/${done}`,
        send("PATCH", { clientMutationId: cmid(), completed: true }),
      ),
    );
    await t.db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, gone));

    const page = await inbox(me);
    expect(page.items.map((i) => i.taskId).sort()).toEqual([done, parent.id].sort());
    expect(page.tasks.find((x) => x.id === done)?.completedAt).not.toBeNull();
    expect(page.tasks.map((x) => x.id)).toContain(sub.id);
    // The item row survives completion, so reopening brings the task back.
    const rows = await t.db
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, me.id), eq(inboxItems.taskId, done)));
    expect(rows).toHaveLength(1);
  });

  it("drops items whose task the caller can no longer see", async () => {
    const owner = await makeUser(t.db);
    const other = await makeUser(t.db);
    const list = await makeList(t.db, owner);
    const id = await listTask(owner, list.id, "Was visible");
    // An item for a task the user can't see (e.g. a list un-shared later).
    await t.db
      .insert(inboxItems)
      .values({ userId: other.id, taskId: id, position: "a0", reason: "manual" });
    expect((await inbox(other)).items).toEqual([]);
  });
});

describe("task events reach the Inbox and Today", () => {
  it("sends list task changes to the list owner's user channel too", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const list = await makeList(t.db, me, { workspaceId: ws.id });
    const id = await listTask(me, list.id, "Watch me");
    await ok(
      await request(me, `/tasks/${id}`, send("PATCH", { clientMutationId: cmid(), priority: 1 })),
    );
    const sent = (await events()).filter((e) => e.event.entity === "task" && e.event.id === id);
    expect(sent.at(-1)?.channels.sort()).toEqual(
      [channel.list(list.id), channel.user(me.id)].sort(),
    );
  });
});
