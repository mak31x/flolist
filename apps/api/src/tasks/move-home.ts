import { blocks, inboxItems, tasks, type Executor } from "@flolist/db";
import { channel, positionAfter, positionBetween } from "@flolist/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ListRow, TaskRow } from "../authz/authorize.ts";
import { blockDtos } from "../blocks/dto.ts";
import { ApiException } from "../lib/errors.ts";
import { putInboxItem } from "../routes/inbox.ts";
import type { MutationScope } from "../sync/mutation.ts";
import { taskChannels } from "./audience.ts";
import { emitTasks, liveBlockOfTask, logActivity, taskSubtreeIds } from "./service.ts";

/** The top of the user's Inbox (a position before every item). */
async function inboxTop(tx: Executor, userId: string): Promise<string> {
  const [first] = await tx
    .select({ position: inboxItems.position })
    .from(inboxItems)
    .where(eq(inboxItems.userId, userId))
    .orderBy(asc(inboxItems.position))
    .limit(1);
  return positionBetween(null, first?.position ?? null);
}

/** Re-emits the live body blocks of `ids` (their channels changed with their home). */
async function emitBodies(
  tx: Executor,
  emit: MutationScope["emit"],
  ids: readonly string[],
  channels: string[],
) {
  if (ids.length === 0) return;
  const rows = await tx
    .update(blocks)
    .set({ version: sql`${blocks.version} + 1` })
    .where(
      and(
        eq(blocks.containerType, "task"),
        inArray(blocks.containerId, [...ids]),
        isNull(blocks.deletedAt),
      ),
    )
    .returning();
  for (const dto of await blockDtos(tx, rows)) {
    await emit(channels, {
      op: "upsert",
      entity: "block",
      id: dto.id,
      version: dto.version,
      data: dto,
    });
  }
}

/**
 * "Remove from list" (keyboard-shortcuts.md ⌘⇧R): a task in a list leaves it with its
 * subtasks and body; it becomes a top-level task in no list at the top of the actor's Inbox.
 * Its block is deleted outright, not trashed: it was only the task's place in the list, and
 * `blocks.task_id` is unique, so a trashed copy would block the task from ever getting a block
 * again (D-075). The task itself keeps everything.
 */
export async function removeFromList(
  { tx, user, emit }: MutationScope,
  task: TaskRow,
  list: ListRow,
): Promise<void> {
  const now = new Date();
  const ids = await taskSubtreeIds(tx, task.id);
  const block = await liveBlockOfTask(tx, task.id);
  if (block) {
    await tx.delete(blocks).where(eq(blocks.id, block.id));
    await emit([channel.list(list.rootListId)], {
      op: "delete",
      entity: "block",
      id: block.id,
      version: block.version + 1,
    });
  }
  await tx
    .update(blocks)
    .set({ rootListId: null })
    .where(and(eq(blocks.containerType, "task"), inArray(blocks.containerId, ids)));
  await tx
    .update(tasks)
    .set({ listId: null, rootListId: null, version: sql`${tasks.version} + 1` })
    .where(inArray(tasks.id, ids));
  await tx.update(tasks).set({ parentTaskId: null }).where(eq(tasks.id, task.id));
  await putInboxItem(tx, emit, user.id, task.id, await inboxTop(tx, user.id), "manual");
  await logActivity(tx, {
    task: { id: task.id, workspaceId: task.workspaceId, rootListId: null },
    actorId: user.id,
    action: "moved",
    field: "list",
    old: { id: list.id, title: list.title },
    new: null,
    now,
  });
  // The old list's page drops the subtree's body blocks; their new audience gets them back.
  const bodies = await tx
    .select({ id: blocks.id, version: blocks.version })
    .from(blocks)
    .where(
      and(
        eq(blocks.containerType, "task"),
        inArray(blocks.containerId, ids),
        isNull(blocks.deletedAt),
      ),
    );
  for (const row of bodies) {
    await emit([channel.list(list.rootListId)], {
      op: "delete",
      entity: "block",
      id: row.id,
      version: row.version,
    });
  }
  const channels = (await taskChannels(tx, [task.id])).get(task.id) ?? [];
  await emitBodies(tx, emit, ids, channels);
  await emitTasks(tx, emit, ids);
}

/**
 * Moves a top-level task in no list onto the end of `target` (a drop on a sidebar list, Move to
 * list…). It gets a block there, its subtree and body follow, and it leaves the actor's Inbox
 * ("dragged onto a list (which moves it there)", views.md → Inbox).
 */
export async function moveIntoList(
  { tx, user, emit }: MutationScope,
  task: TaskRow,
  target: { list: ListRow; root: ListRow },
): Promise<string> {
  if (task.parentTaskId) {
    throw new ApiException("CONFLICT", "Move the top-level task");
  }
  if (target.list.workspaceId !== task.workspaceId) {
    throw new ApiException("CONFLICT", "The list is in another workspace");
  }
  const now = new Date();
  const ids = await taskSubtreeIds(tx, task.id);
  const [last] = await tx
    .select({ position: blocks.position })
    .from(blocks)
    .where(
      and(
        eq(blocks.containerType, "list"),
        eq(blocks.containerId, target.list.id),
        isNull(blocks.deletedAt),
      ),
    )
    .orderBy(desc(blocks.position))
    .limit(1);
  await tx
    .update(tasks)
    .set({
      listId: target.list.id,
      rootListId: target.root.id,
      version: sql`${tasks.version} + 1`,
    })
    .where(inArray(tasks.id, ids));
  await tx
    .update(blocks)
    .set({ rootListId: target.root.id })
    .where(and(eq(blocks.containerType, "task"), inArray(blocks.containerId, ids)));
  const [created] = await tx
    .insert(blocks)
    .values({
      containerType: "list",
      containerId: target.list.id,
      rootListId: target.root.id,
      position: positionAfter(last?.position ?? null),
      type: "task",
      content: { inline: task.titleInline },
      taskId: task.id,
      createdBy: user.id,
    })
    .returning();
  if (!created) throw new Error("block insert failed");
  const removed = await tx
    .delete(inboxItems)
    .where(and(eq(inboxItems.userId, user.id), eq(inboxItems.taskId, task.id)))
    .returning();
  for (const row of removed) {
    await emit([channel.user(user.id)], {
      op: "delete",
      entity: "inboxItem",
      id: task.id,
      version: row.updatedAt.getTime(),
    });
  }
  await logActivity(tx, {
    task: { id: task.id, workspaceId: task.workspaceId, rootListId: target.root.id },
    actorId: user.id,
    action: "moved",
    field: "list",
    old: null,
    new: { id: target.list.id, title: target.list.title },
    now,
  });
  const listChannel = [channel.list(target.root.id)];
  for (const dto of await blockDtos(tx, [created])) {
    await emit(listChannel, {
      op: "upsert",
      entity: "block",
      id: dto.id,
      version: dto.version,
      data: dto,
    });
  }
  await emitBodies(tx, emit, ids, listChannel);
  await emitTasks(tx, emit, ids);
  return created.id;
}
