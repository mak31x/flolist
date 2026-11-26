import { activityEvents, blocks, tasks, type Executor } from "@flolist/db";
import {
  ACTIVITY_MERGE_MINUTES,
  channel,
  type ActivityAction,
  taskTitleText,
  type InlineNode,
  type Task,
} from "@flolist/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BlockRow } from "../blocks/dto.ts";
import type { MutationScope } from "../sync/mutation.ts";

export type TaskRow = typeof tasks.$inferSelect;

export function taskDto(row: TaskRow, blockId: string | null): Task {
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
            data: taskDto(row, blockOf.get(row.id) ?? null),
          },
    );
  }
}

/**
 * Changes a task's title and/or completion and logs it. Returns the updated row, or null when
 * nothing changed. The caller keeps the task block's content in step with the title.
 */
export async function patchTask(
  tx: Executor,
  task: TaskRow,
  change: { inline?: InlineNode[] | undefined; completed?: boolean | undefined },
  actorId: string,
  now: Date,
): Promise<TaskRow | null> {
  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (change.inline) {
    const title = taskTitleText(change.inline);
    patch.titleInline = change.inline;
    patch.title = title;
    if (title !== task.title) {
      await logActivity(tx, {
        task,
        actorId,
        action: "title_changed",
        field: "title",
        old: task.title,
        new: title,
        now,
      });
    }
  }
  if (change.completed !== undefined && change.completed !== (task.completedAt !== null)) {
    patch.completedAt = change.completed ? now : null;
    patch.completedBy = change.completed ? actorId : null;
    await logActivity(tx, {
      task,
      actorId,
      action: change.completed ? "completed" : "reopened",
      now,
    });
  }
  if (Object.keys(patch).length === 0) return null;
  const [updated] = await tx
    .update(tasks)
    .set({ ...patch, version: sql`${tasks.version} + 1` })
    .where(eq(tasks.id, task.id))
    .returning();
  return updated ?? null;
}
