import { lists, outbox, tasks, user } from "@flolist/db";
import {
  apiErrorSchema,
  changeEventSchema,
  channel,
  todayPageSchema,
  uuidv7,
} from "@flolist/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import {
  as,
  makeInboxOnlyTask,
  makeList,
  makePersonalWorkspace,
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
const DAY = "2026-11-28";

async function ok(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

const request = (who: { id: string }, path: string, init: RequestInit = {}) =>
  testApp(t.db).request(`/api/v1${path}`, as(who, init));

async function today(who: { id: string }, date = DAY) {
  return todayPageSchema.parse(await ok(await request(who, `/today?date=${date}`)));
}

/** A task row in a list (or in no list), with optional due date and completion. */
async function task(
  owner: { id: string },
  values: {
    workspaceId: string;
    listId?: string | null;
    rootListId?: string | null;
    due?: string | null;
    time?: string | null;
    completedAt?: Date | null;
    parentTaskId?: string;
    deleted?: boolean;
  },
) {
  const [row] = await t.db
    .insert(tasks)
    .values({
      id: uuidv7(),
      workspaceId: values.workspaceId,
      listId: values.listId ?? null,
      rootListId: values.rootListId ?? values.listId ?? null,
      parentTaskId: values.parentTaskId ?? null,
      title: "T",
      dueDate: values.due ?? null,
      dueTime: values.time ?? null,
      dueTz: values.due ? "Europe/Berlin" : null,
      completedAt: values.completedAt ?? null,
      createdBy: owner.id,
      deletedAt: values.deleted ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error("insert task failed");
  return row;
}

async function world() {
  const me = await makeUser(t.db);
  const ws = await makePersonalWorkspace(t.db, me);
  const list = await makeList(t.db, me, { workspaceId: ws.id });
  return { me, ws, list };
}

describe("GET /today", () => {
  it("shows open tasks due that day or earlier, from lists and the Inbox", async () => {
    const { me, ws, list } = await world();
    const dueToday = await task(me, { workspaceId: ws.id, listId: list.id, due: DAY });
    const overdue = await task(me, { workspaceId: ws.id, listId: list.id, due: "2026-11-20" });
    const inboxOnly = await task(me, { workspaceId: ws.id, due: DAY });
    const subOfInbox = await task(me, {
      workspaceId: ws.id,
      due: DAY,
      parentTaskId: inboxOnly.id,
    });
    await task(me, { workspaceId: ws.id, listId: list.id, due: "2026-11-29" }); // tomorrow
    await task(me, { workspaceId: ws.id, listId: list.id }); // undated
    await task(me, { workspaceId: ws.id, listId: list.id, due: DAY, completedAt: new Date() });
    await task(me, { workspaceId: ws.id, listId: list.id, due: DAY, deleted: true });

    const page = await today(me);
    expect(page.open.map((x) => x.id).sort()).toEqual(
      [dueToday.id, overdue.id, inboxOnly.id, subOfInbox.id].sort(),
    );
    // Another day moves the window.
    expect((await today(me, "2026-11-21")).open.map((x) => x.id)).toEqual([overdue.id]);
  });

  it("never shows other people's tasks or tasks of deleted lists", async () => {
    const { me, ws, list } = await world();
    const other = await world();
    await task(other.me, { workspaceId: other.ws.id, listId: other.list.id, due: DAY });
    await makeInboxOnlyTask(t.db, other.me, { workspaceId: other.ws.id });
    const gone = await makeList(t.db, me, { workspaceId: ws.id });
    await task(me, { workspaceId: ws.id, listId: gone.id, due: DAY });
    await t.db.update(lists).set({ deletedAt: new Date() }).where(eq(lists.id, gone.id));
    const mine = await task(me, { workspaceId: ws.id, listId: list.id, due: DAY });
    expect((await today(me)).open.map((x) => x.id)).toEqual([mine.id]);
  });

  it("lists tasks completed that day in the profile time zone", async () => {
    const { me, ws, list } = await world();
    await t.db.update(user).set({ timezone: "Asia/Kolkata" }).where(eq(user.id, me.id));
    // 22:00 UTC on the 27th is 03:30 on the 28th in Kolkata.
    const lateUtc = await task(me, {
      workspaceId: ws.id,
      listId: list.id,
      completedAt: new Date("2026-11-27T22:00:00Z"),
    });
    await task(me, {
      workspaceId: ws.id,
      listId: list.id,
      completedAt: new Date("2026-11-27T10:00:00Z"),
    });
    expect((await today(me)).completed.map((x) => x.id)).toEqual([lateUtc.id]);
  });

  it("validates the date and requires a session", async () => {
    const { me } = await world();
    expect((await request(me, "/today?date=tomorrow")).status).toBe(400);
    expect((await testApp(t.db).request(`/api/v1/today?date=${DAY}`)).status).toBe(401);
  });
});

describe("PUT /today/order", () => {
  it("stores the manual order per day and emits it to the user", async () => {
    const { me, ws, list } = await world();
    const a = await task(me, { workspaceId: ws.id, listId: list.id, due: DAY });
    await ok(
      await request(
        me,
        "/today/order",
        send("PUT", { clientMutationId: cmid(), date: DAY, taskId: a.id, position: "a3" }),
      ),
    );
    expect((await today(me)).order).toEqual({ [a.id]: "a3" });
    expect((await today(me, "2026-11-29")).order).toEqual({});
    const rows = await t.db.select().from(outbox);
    const sent = rows
      .map((r) => ({ channels: r.channels, e: changeEventSchema.parse(r.event) }))
      .find((x) => x.e.entity === "todayOrder" && x.e.id === a.id);
    expect(sent?.channels).toEqual([channel.user(me.id)]);
  });

  it("can't order a task the caller can't see", async () => {
    const { me } = await world();
    const other = await world();
    const theirs = await task(other.me, {
      workspaceId: other.ws.id,
      listId: other.list.id,
      due: DAY,
    });
    const res = await request(
      me,
      "/today/order",
      send("PUT", { clientMutationId: cmid(), date: DAY, taskId: theirs.id, position: "a0" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /today/reschedule", () => {
  it("moves overdue tasks to the day, keeping their time, and logs it", async () => {
    const { me, ws, list } = await world();
    const a = await task(me, {
      workspaceId: ws.id,
      listId: list.id,
      due: "2026-11-20",
      time: "09:30",
    });
    const b = await task(me, { workspaceId: ws.id, due: "2026-11-25" });
    const body = (await ok(
      await request(
        me,
        "/today/reschedule",
        send("POST", { clientMutationId: cmid(), date: DAY, taskIds: [a.id, b.id] }),
      ),
    )) as { changed: string[] };
    expect(body.changed.sort()).toEqual([a.id, b.id].sort());
    const [rowA] = await t.db.select().from(tasks).where(eq(tasks.id, a.id));
    expect(rowA).toMatchObject({ dueDate: DAY, dueTime: "09:30:00", dueTz: "Europe/Berlin" });
    const page = await today(me);
    expect(page.open.find((x) => x.id === a.id)?.due).toEqual({
      date: DAY,
      time: "09:30",
      tz: "Europe/Berlin",
    });
  });

  it("is all or nothing when one task isn't the caller's", async () => {
    const { me, ws, list } = await world();
    const other = await world();
    const mine = await task(me, { workspaceId: ws.id, listId: list.id, due: "2026-11-20" });
    const theirs = await task(other.me, {
      workspaceId: other.ws.id,
      listId: other.list.id,
      due: "2026-11-20",
    });
    const res = await request(
      me,
      "/today/reschedule",
      send("POST", { clientMutationId: cmid(), date: DAY, taskIds: [mine.id, theirs.id] }),
    );
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("NOT_FOUND");
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, mine.id));
    expect(row?.dueDate).toBe("2026-11-20");
  });
});
