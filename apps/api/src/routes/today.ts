import {
  lists,
  member,
  tasks,
  todayOrder,
  user as users,
  workspaces,
  type Executor,
} from "@flolist/db";
import {
  channel,
  putTodayOrderSchema,
  rescheduleSchema,
  todayQuerySchema,
  type TodayOrder,
  type TodayPage,
} from "@flolist/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { authorize } from "../authz/authorize.ts";
import { unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { dbOf, type AppEnv, type AuthUser } from "../types.ts";
import { topTaskIds } from "../tasks/audience.ts";
import { applyTaskChange, dueDto, taskDtosOf, type TaskRow } from "../tasks/service.ts";

type Filter = "open" | "completed";

/**
 * Tasks the user can access (data-model.md → Access resolution, until sharing M7.2): those in
 * live lists whose root they created, and those in no list under a top-level task they
 * created. `which` picks open tasks due on `date` or earlier, or tasks completed on `date` in
 * `tz`.
 */
async function accessibleTasks(
  db: Executor,
  user: AuthUser,
  which: Filter,
  date: string,
  tz: string,
): Promise<TaskRow[]> {
  const when =
    which === "open"
      ? sql`${tasks.completedAt} is null and ${tasks.dueDate} <= ${date}`
      : sql`${tasks.completedAt} is not null and (${tasks.completedAt} at time zone ${tz})::date = ${date}`;
  const home = alias(lists, "home");
  const root = alias(lists, "root");
  const inLists = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(home, and(eq(home.id, tasks.listId), isNull(home.deletedAt)))
    .innerJoin(root, and(eq(root.id, tasks.rootListId), isNull(root.deletedAt)))
    .where(and(isNull(tasks.deletedAt), eq(root.createdBy, user.id), when));
  // Tasks in no list: only in workspaces the user belongs to, then by their top-level task.
  const myWorkspaces = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .leftJoin(
      member,
      and(eq(member.organizationId, workspaces.organizationId), eq(member.userId, user.id)),
    )
    .where(
      and(
        isNull(workspaces.deletedAt),
        sql`(${workspaces.ownerId} = ${user.id} or ${member.userId} is not null)`,
      ),
    );
  const loose = await db
    .select({ id: tasks.id, createdBy: tasks.createdBy, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        isNull(tasks.listId),
        inArray(tasks.workspaceId, myWorkspaces),
        when,
      ),
    );
  const tops = await topTaskIds(
    db,
    loose.filter((r) => r.parentTaskId).map((r) => r.id),
  );
  const topRows =
    tops.size === 0
      ? []
      : await db
          .select({ id: tasks.id, createdBy: tasks.createdBy, deletedAt: tasks.deletedAt })
          .from(tasks)
          .where(inArray(tasks.id, [...new Set(tops.values())]));
  const topOf = new Map(topRows.map((r) => [r.id, r]));
  const looseIds = loose
    .filter((r) => {
      if (!r.parentTaskId) return r.createdBy === user.id;
      const top = topOf.get(tops.get(r.id) ?? "");
      return top !== undefined && top.deletedAt === null && top.createdBy === user.id;
    })
    .map((r) => r.id);
  const ids = [...new Set([...inLists.map((r) => r.id), ...looseIds])];
  if (ids.length === 0) return [];
  return db.select().from(tasks).where(inArray(tasks.id, ids));
}

function todayOrderDto(row: typeof todayOrder.$inferSelect): TodayOrder {
  return {
    date: row.date,
    taskId: row.taskId,
    position: row.position,
    version: row.updatedAt.getTime(),
  };
}

export const todayRoutes = new Hono<AppEnv>()
  /** The Today view for one day (views.md → Today). */
  .get("/", validate("query", todayQuerySchema), async (c) => {
    const db = dbOf(c);
    const user = c.get("user");
    if (!user) throw unauthenticated();
    const { date } = c.req.valid("query");
    const [profile] = await db
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, user.id));
    const tz = profile?.timezone ?? "UTC";
    const [open, completed, order] = await Promise.all([
      accessibleTasks(db, user, "open", date, tz),
      accessibleTasks(db, user, "completed", date, tz),
      db
        .select({ taskId: todayOrder.taskId, position: todayOrder.position })
        .from(todayOrder)
        .where(and(eq(todayOrder.userId, user.id), eq(todayOrder.date, date))),
    ]);
    const body: TodayPage = {
      date,
      open: await taskDtosOf(db, open),
      completed: await taskDtosOf(db, completed),
      order: Object.fromEntries(order.map((o) => [o.taskId, o.position])),
    };
    return c.json(body);
  })

  /** Places a task in the caller's manual order for one day. */
  .put("/order", validate("json", putTodayOrderSchema), async (c) => {
    const input = c.req.valid("json");
    return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
      await authorize(tx, user, "task.view", { type: "task", id: input.taskId });
      const now = new Date();
      const [row] = await tx
        .insert(todayOrder)
        .values({
          userId: user.id,
          date: input.date,
          taskId: input.taskId,
          position: input.position,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [todayOrder.userId, todayOrder.date, todayOrder.taskId],
          set: { position: input.position, updatedAt: now },
        })
        .returning();
      if (!row) throw new Error("today order upsert failed");
      const dto = todayOrderDto(row);
      await emit([channel.user(user.id)], {
        op: "upsert",
        entity: "todayOrder",
        id: dto.taskId,
        version: dto.version,
        data: dto,
      });
      return { status: 200, body: dto };
    });
  })

  /**
   * Overdue → "Reschedule all": each task becomes due on `date`, keeping its time and zone
   * (views.md → Today `[assumption]`). All or nothing: one task the caller can't edit fails it.
   */
  .post("/reschedule", validate("json", rescheduleSchema), async (c) => {
    const input = c.req.valid("json");
    return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
      const now = new Date();
      const changed: string[] = [];
      for (const id of [...new Set(input.taskIds)]) {
        const { task } = await authorize(tx, user, "task.edit", { type: "task", id, lock: true });
        const due = dueDto(task);
        const result = await applyTaskChange(
          tx,
          emit,
          user.id,
          task,
          { due: { date: input.date, time: due?.time ?? null, ...(due ? { tz: due.tz } : {}) } },
          now,
        );
        if (result.task !== task) changed.push(id);
      }
      return { status: 200, body: { changed } };
    });
  });
