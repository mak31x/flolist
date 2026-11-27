import {
  activityEvents,
  blocks,
  labels,
  taskLabels,
  tasks,
  user as users,
  type Executor,
} from "@flolist/db";
import {
  ACTIVITY_MERGE_MINUTES,
  channel,
  type ActivityAction,
  taskTitleText,
  type InlineNode,
  type Task,
  type TaskDue,
  type TaskFieldsInput,
} from "@flolist/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { notFound } from "../lib/errors.ts";
import { blockDtos, type BlockRow } from "../blocks/dto.ts";
import type { MutationScope } from "../sync/mutation.ts";

export type TaskRow = typeof tasks.$inferSelect;

/** The stored due date as the DTO shows it (`due_time` comes back as `HH:mm:ss`). */
export function dueDto(row: Pick<TaskRow, "dueDate" | "dueTime" | "dueTz">): TaskDue | null {
  if (!row.dueDate || !row.dueTz) return null;
  return { date: row.dueDate, time: row.dueTime?.slice(0, 5) ?? null, tz: row.dueTz };
}

/** Each task's label ids, in the order they were added. */
export async function labelIdsByTask(
  db: Executor,
  taskIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (taskIds.length === 0) return out;
  const rows = await db
    .select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
    .from(taskLabels)
    .where(inArray(taskLabels.taskId, [...new Set(taskIds)]))
    .orderBy(asc(taskLabels.createdAt), asc(taskLabels.labelId));
  for (const r of rows) {
    const list = out.get(r.taskId) ?? [];
    list.push(r.labelId);
    out.set(r.taskId, list);
  }
  return out;
}

export async function taskDtoOf(db: Executor, row: TaskRow, blockId: string | null) {
  const ids = await labelIdsByTask(db, [row.id]);
  return taskDto(row, blockId, ids.get(row.id) ?? []);
}

export function taskDto(row: TaskRow, blockId: string | null, labelIds: string[]): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    listId: row.listId,
    rootListId: row.rootListId,
    parentTaskId: row.parentTaskId,
    blockId,
    title: row.title,
    titleInline: row.titleInline as InlineNode[],
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    due: dueDto(row),
    priority: row.priority,
    labelIds,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** The task and every live subtask below it (any depth), following `parent_task_id`. */
export async function taskSubtreeIds(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive tree(id) as (
      select ${tasks.id} from ${tasks} where ${tasks.id} = ${id} and ${tasks.deletedAt} is null
      union all
      select t.id from ${tasks} t join tree on t.parent_task_id = tree.id
      where t.deleted_at is null
    )
    select id from tree
  `);
  return result.rows.map((r) => r.id);
}

/**
 * Sends a task tree to Trash with `trashRootId` (the block the user deleted or turned into
 * text): the tasks and the live blocks of their bodies. Returns the body blocks it removed.
 */
export async function trashTaskTree(
  tx: Executor,
  taskId: string,
  trashRootId: string,
  userId: string,
  now: Date,
): Promise<BlockRow[]> {
  const ids = await taskSubtreeIds(tx, taskId);
  if (ids.length === 0) return [];
  await tx
    .update(tasks)
    .set({
      deletedAt: now,
      deletedBy: userId,
      trashRootId,
      version: sql`${tasks.version} + 1`,
    })
    .where(inArray(tasks.id, ids));
  return tx
    .update(blocks)
    .set({ deletedAt: now, deletedBy: userId, trashRootId, version: sql`${blocks.version} + 1` })
    .where(
      and(
        eq(blocks.containerType, "task"),
        inArray(blocks.containerId, ids),
        isNull(blocks.deletedAt),
      ),
    )
    .returning();
}

/** Brings back what `trashTaskTree(…, trashRootId)` removed. Returns the restored body blocks. */
export async function restoreTaskTree(tx: Executor, trashRootId: string): Promise<BlockRow[]> {
  await tx
    .update(tasks)
    .set({
      deletedAt: null,
      deletedBy: null,
      trashRootId: null,
      version: sql`${tasks.version} + 1`,
    })
    .where(eq(tasks.trashRootId, trashRootId));
  return tx
    .update(blocks)
    .set({
      deletedAt: null,
      deletedBy: null,
      trashRootId: null,
      version: sql`${blocks.version} + 1`,
    })
    .where(and(eq(blocks.trashRootId, trashRootId), eq(blocks.containerType, "task")))
    .returning();
}

export interface ActivityInput {
  task: Pick<TaskRow, "id" | "workspaceId" | "rootListId">;
  actorId: string;
  action: ActivityAction;
  field?: string;
  old?: unknown;
  new?: unknown;
  now: Date;
}

/**
 * Writes one activity entry. A title change by the same person within
 * `ACTIVITY_MERGE_MINUTES` of their last title change (or of creating the task) updates that
 * entry instead, so typing doesn't log every pause `[assumption]`.
 */
export async function logActivity(tx: Executor, input: ActivityInput): Promise<void> {
  if (input.action === "title_changed") {
    const [last] = await tx
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "task"), eq(activityEvents.entityId, input.task.id)))
      .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
      .limit(1);
    const since = input.now.getTime() - ACTIVITY_MERGE_MINUTES * 60_000;
    if (
      last &&
      last.actorId === input.actorId &&
      (last.action === "title_changed" || last.action === "created") &&
      last.createdAt.getTime() >= since
    ) {
      await tx
        .update(activityEvents)
        .set({ new: input.new ?? null })
        .where(eq(activityEvents.id, last.id));
      return;
    }
  }
  await tx.insert(activityEvents).values({
    workspaceId: input.task.workspaceId,
    rootListId: input.task.rootListId,
    entityType: "task",
    entityId: input.task.id,
    actorId: input.actorId,
    action: input.action,
    field: input.field ?? null,
    old: input.old ?? null,
    new: input.new ?? null,
    createdAt: input.now,
  });
}

/** Emits `task` upserts (live rows) or deletes (soft-deleted rows) for `ids`. */
export async function emitTasks(
  tx: Executor,
  emit: MutationScope["emit"],
  ids: Iterable<string>,
): Promise<void> {
  const list = [...new Set(ids)];
  if (list.length === 0) return;
  const rows = await tx.select().from(tasks).where(inArray(tasks.id, list));
  const blockRows = await tx
    .select({ id: blocks.id, taskId: blocks.taskId })
    .from(blocks)
    .where(inArray(blocks.taskId, list));
  const blockOf = new Map(blockRows.map((b) => [b.taskId, b.id]));
  const labelsOf = await labelIdsByTask(tx, list);
  for (const row of rows) {
    const channels = row.rootListId ? [channel.list(row.rootListId)] : [];
    await emit(
      channels,
      row.deletedAt
        ? { op: "delete", entity: "task", id: row.id, version: row.version }
        : {
            op: "upsert",
            entity: "task",
            id: row.id,
            version: row.version,
            data: taskDto(row, blockOf.get(row.id) ?? null, labelsOf.get(row.id) ?? []),
          },
    );
  }
}

export type TaskChange = TaskFieldsInput & {
  inline?: InlineNode[] | undefined;
  completed?: boolean | undefined;
};

const sameDue = (a: TaskDue | null, b: TaskDue | null) =>
  a === b || (a !== null && b !== null && a.date === b.date && a.time === b.time && a.tz === b.tz);

/** The actor's profile time zone: the default zone of a due date set without one. */
async function profileTimeZone(tx: Executor, userId: string): Promise<string> {
  const [row] = await tx
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  return row?.timezone ?? "UTC";
}

/**
 * Replaces a task's labels with `ids` (labels already on it keep their place; new ones go to
 * the end). Every id must be a label of the task's workspace. Returns the names before and
 * after for the activity log, or null when nothing changed.
 */
async function setTaskLabels(
  tx: Executor,
  task: TaskRow,
  ids: readonly string[],
  now: Date,
): Promise<{ old: string[]; new: string[] } | null> {
  const current = (await labelIdsByTask(tx, [task.id])).get(task.id) ?? [];
  const added = ids.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !ids.includes(id));
  if (added.length === 0 && removed.length === 0) return null;
  const known = await tx
    .select({ id: labels.id, name: labels.name })
    .from(labels)
    .where(
      and(
        eq(labels.workspaceId, task.workspaceId),
        inArray(labels.id, [...new Set([...current, ...ids])]),
      ),
    );
  const nameOf = new Map(known.map((l) => [l.id, l.name]));
  if (added.some((id) => !nameOf.has(id))) throw notFound("Label");
  if (removed.length > 0) {
    await tx
      .delete(taskLabels)
      .where(and(eq(taskLabels.taskId, task.id), inArray(taskLabels.labelId, removed)));
  }
  if (added.length > 0) {
    await tx
      .insert(taskLabels)
      .values(
        added.map((labelId, i) => ({
          taskId: task.id,
          labelId,
          createdAt: new Date(now.getTime() + i),
        })),
      )
      .onConflictDoNothing();
  }
  const names = (list: readonly string[]) => list.map((id) => nameOf.get(id) ?? "");
  return {
    old: names(current),
    new: names([...current.filter((id) => ids.includes(id)), ...added]),
  };
}

/**
 * Changes a task's title, completion, due date, priority and/or labels (only the fields sent)
 * and logs each change. Returns the updated row, or null when nothing changed. The caller
 * keeps the task block's content in step with the title.
 */
export async function patchTask(
  tx: Executor,
  task: TaskRow,
  change: TaskChange,
  actorId: string,
  now: Date,
): Promise<TaskRow | null> {
  const patch: Partial<typeof tasks.$inferInsert> = {};
  const log = (action: ActivityAction, field?: string, old?: unknown, next?: unknown) =>
    logActivity(tx, { task, actorId, action, now, ...(field ? { field, old, new: next } : {}) });
  if (change.inline) {
    const title = taskTitleText(change.inline);
    patch.titleInline = change.inline;
    patch.title = title;
    if (title !== task.title) await log("title_changed", "title", task.title, title);
  }
  if (change.completed !== undefined && change.completed !== (task.completedAt !== null)) {
    patch.completedAt = change.completed ? now : null;
    patch.completedBy = change.completed ? actorId : null;
    await log(change.completed ? "completed" : "reopened");
  }
  if (change.due !== undefined) {
    const next: TaskDue | null = change.due && {
      date: change.due.date,
      time: change.due.time ?? null,
      tz: change.due.tz ?? (await profileTimeZone(tx, actorId)),
    };
    const old = dueDto(task);
    if (!sameDue(old, next)) {
      patch.dueDate = next?.date ?? null;
      patch.dueTime = next?.time ?? null;
      patch.dueTz = next?.tz ?? null;
      await log("due_changed", "due", old, next);
    }
  }
  if (change.priority !== undefined && change.priority !== task.priority) {
    patch.priority = change.priority;
    await log("priority_changed", "priority", task.priority, change.priority);
  }
  let labelsChanged = false;
  if (change.labelIds !== undefined) {
    const names = await setTaskLabels(tx, task, change.labelIds, now);
    if (names) {
      labelsChanged = true;
      await log("labels_changed", "labels", names.old, names.new);
    }
  }
  if (Object.keys(patch).length === 0 && !labelsChanged) return null;
  const [updated] = await tx
    .update(tasks)
    .set({ ...patch, version: sql`${tasks.version} + 1` })
    .where(eq(tasks.id, task.id))
    .returning();
  return updated ?? null;
}

/**
 * Bumps the versions of tasks whose fields changed from outside them (a label merged or
 * deleted) and emits their block and task events, so open pages patch their rows.
 */
export async function touchTasks(
  tx: Executor,
  emit: MutationScope["emit"],
  ids: readonly string[],
): Promise<void> {
  const list = [...new Set(ids)];
  if (list.length === 0) return;
  await tx
    .update(tasks)
    .set({ version: sql`${tasks.version} + 1` })
    .where(inArray(tasks.id, list));
  const touched = await tx
    .update(blocks)
    .set({ version: sql`${blocks.version} + 1` })
    .where(and(inArray(blocks.taskId, list), isNull(blocks.deletedAt)))
    .returning();
  for (const dto of await blockDtos(tx, touched)) {
    await emit([channel.list(dto.rootListId)], {
      op: "upsert",
      entity: "block",
      id: dto.id,
      version: dto.version,
      data: dto,
    });
  }
  await emitTasks(tx, emit, list);
}
