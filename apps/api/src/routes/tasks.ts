import { activityEvents, blocks, tasks, user as users, type Executor } from "@flolist/db";
import {
  activityActionSchema,
  blockBatchSchema,
  fileUrl,
  idParamSchema,
  moveTaskSchema,
  taskTrashSchema,
  updateTaskSchema,
  type ActivityPage,
  type TaskPage,
} from "@flolist/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { authorize, type TaskRow } from "../authz/authorize.ts";
import { applyBlockBatch, type BatchPage } from "../blocks/batch.ts";
import { blockDtos } from "../blocks/dto.ts";
import { ApiException, notFound } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation, type MutationScope } from "../sync/mutation.ts";
import { dbOf, type AppEnv } from "../types.ts";
import { taskChannels, topTaskIds } from "../tasks/audience.ts";
import { moveIntoList, removeFromList } from "../tasks/move-home.ts";
import {
  applyTaskChange,
  emitTasks,
  liveBlockOfTask,
  logActivity,
  restoreTaskTree,
  taskDtoOf,
  taskSubtreeIds,
  trashTaskTree,
} from "../tasks/service.ts";

/** The top-level task of a task in no list; its body page is the subtasks' page too. */
async function pageTaskOf(db: Executor, task: TaskRow): Promise<TaskRow> {
  if (task.listId) {
    throw new ApiException("CONFLICT", "This task's body is on its list's page");
  }
  if (!task.parentTaskId) return task;
  const topId = (await topTaskIds(db, [task.id])).get(task.id);
  const [top] = topId
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, topId), isNull(tasks.deletedAt)))
    : [];
  if (!top) throw notFound("Task");
  return top;
}

async function taskBatchPage(db: Executor, top: TaskRow): Promise<BatchPage> {
  return {
    listId: null,
    rootListId: null,
    workspaceId: top.workspaceId,
    top: { type: "task", id: top.id },
    blockChannels: (await taskChannels(db, [top.id])).get(top.id) ?? [],
    listChannels: [],
  };
}

/** Emits block deletes (trashed) or upserts (restored) for a task tree's body blocks. */
async function emitBodyBlocks(
  tx: Executor,
  emit: MutationScope["emit"],
  channels: string[],
  rows: (typeof blocks.$inferSelect)[],
  trashed: boolean,
) {
  if (trashed) {
    for (const row of rows) {
      await emit(channels, { op: "delete", entity: "block", id: row.id, version: row.version });
    }
    return;
  }
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

export const taskRoutes = new Hono<AppEnv>()
  /** The task as the details panel shows it. */
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const db = dbOf(c);
    const { task } = await authorize(db, c.get("user"), "task.view", {
      type: "task",
      id: c.req.valid("param").id,
    });
    const block = await liveBlockOfTask(db, task.id);
    return c.json(await taskDtoOf(db, task, block?.id ?? null));
  })

  /**
   * Changes the title, completion, due date, priority or labels (field-level LWW, D-006) from
   * places without a block store (the details panel header, Inbox and Today rows). The task
   * block's content follows the title in the same transaction.
   */
  .patch(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateTaskSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const { task } = await authorize(tx, user, "task.edit", {
          type: "task",
          id,
          lock: true,
        });
        const { task: updated, block } = await applyTaskChange(tx, emit, user.id, task, {
          inline: input.titleInline,
          completed: input.completed,
          due: input.due,
          priority: input.priority,
          labelIds: input.labelIds,
        });
        return { status: 200, body: await taskDtoOf(tx, updated, block?.id ?? null) };
      });
    },
  )

  /** The body page of a task in no list (`TaskPage`); a subtask answers its top task's page. */
  .get("/:id/page", validate("param", idParamSchema), async (c) => {
    const db = dbOf(c);
    const { task } = await authorize(db, c.get("user"), "task.view", {
      type: "task",
      id: c.req.valid("param").id,
    });
    const top = await pageTaskOf(db, task);
    const ids = await taskSubtreeIds(db, top.id);
    const rows = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.containerType, "task"),
          inArray(blocks.containerId, ids),
          isNull(blocks.deletedAt),
        ),
      )
      .orderBy(asc(blocks.position), asc(blocks.id));
    const body: TaskPage = { taskId: top.id, items: await blockDtos(db, rows) };
    return c.json(body);
  })

  /**
   * One editor command on the body page of a top-level task in no list (the same batch as a
   * list page, `applyBlockBatch`). Blocks go into the task's body unless `container` names one
   * of its subtasks.
   */
  .post(
    "/:id/blocks/batch",
    validate("param", idParamSchema),
    validate("json", blockBatchSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async (scope) => {
        const { task } = await authorize(scope.tx, scope.user, "task.edit", { type: "task", id });
        const top = await pageTaskOf(scope.tx, task);
        if (top.id !== task.id) {
          throw new ApiException("CONFLICT", "Edit the page of the top-level task");
        }
        const body = await applyBlockBatch(scope, await taskBatchPage(scope.tx, top), input.ops);
        return { status: 200, body };
      });
    },
  )

  /**
   * Sends a top-level task in no list to Trash with its subtasks and body (trash root = the
   * task). Tasks in a list are deleted through their block (the list's batch).
   */
  .delete(
    "/:id",
    validate("param", idParamSchema),
    validate("json", taskTrashSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { clientMutationId } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        const { task } = await authorize(tx, user, "task.edit", { type: "task", id, lock: true });
        if (task.listId || task.parentTaskId) {
          throw new ApiException("CONFLICT", "Delete this task through its block");
        }
        const channels = (await taskChannels(tx, [task.id])).get(task.id) ?? [];
        const ids = await taskSubtreeIds(tx, task.id);
        const body = await trashTaskTree(tx, task.id, task.id, user.id, new Date());
        await emitBodyBlocks(tx, emit, channels, body, true);
        await emitTasks(tx, emit, ids);
        return { status: 200, body: { deleted: ids } };
      });
    },
  )

  /** Undo of DELETE /tasks/:id: brings the tree back (Trash restores it the same way, M6.1). */
  .post(
    "/:id/restore",
    validate("param", idParamSchema),
    validate("json", taskTrashSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { clientMutationId } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
        // Only the creator's own trashed top-level task in no list (the task resource rules).
        if (
          !task ||
          task.listId ||
          task.parentTaskId ||
          task.createdBy !== user.id ||
          task.trashRootId !== task.id
        ) {
          throw notFound("Task");
        }
        const body = await restoreTaskTree(tx, task.id);
        const ids = await taskSubtreeIds(tx, task.id);
        const channels = (await taskChannels(tx, [task.id])).get(task.id) ?? [];
        await emitBodyBlocks(tx, emit, channels, body, false);
        await emitTasks(tx, emit, ids);
        const [restored] = await tx.select().from(tasks).where(eq(tasks.id, id));
        if (restored)
          await logActivity(tx, {
            task: restored,
            actorId: user.id,
            action: "restored",
            now: new Date(),
          });
        return { status: 200, body: { restored: ids } };
      });
    },
  )

  /**
   * Moves a task between a list and no list (`MoveTask`): Remove from list (`listId: null`), or
   * a top-level task in no list onto a list. Both need edit access to the task and the list.
   */
  .post(
    "/:id/move",
    validate("param", idParamSchema),
    validate("json", moveTaskSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async (scope) => {
        const { tx, user } = scope;
        const access = await authorize(tx, user, "task.edit", { type: "task", id, lock: true });
        if (input.listId === null) {
          if (!access.list || !access.root) {
            throw new ApiException("CONFLICT", "This task isn't in a list");
          }
          await removeFromList(scope, access.task, access.list);
          return { status: 200, body: { blockId: null } };
        }
        if (access.list) {
          throw new ApiException("CONFLICT", "Move tasks between lists with move-to");
        }
        const target = await authorize(tx, user, "list.edit", { type: "list", id: input.listId });
        const blockId = await moveIntoList(scope, access.task, target);
        return { status: 200, body: { blockId } };
      });
    },
  )

  /** The activity log, oldest first (tasks.md → Activity log). */
  .get("/:id/activity", validate("param", idParamSchema), async (c) => {
    const db = dbOf(c);
    const { task } = await authorize(db, c.get("user"), "task.view", {
      type: "task",
      id: c.req.valid("param").id,
    });
    const rows = await db
      .select({
        id: activityEvents.id,
        action: activityEvents.action,
        field: activityEvents.field,
        old: activityEvents.old,
        new: activityEvents.new,
        createdAt: activityEvents.createdAt,
        actorId: users.id,
        name: users.name,
        image: users.image,
        avatarFileId: users.avatarFileId,
      })
      .from(activityEvents)
      .leftJoin(users, eq(users.id, activityEvents.actorId))
      .where(and(eq(activityEvents.entityType, "task"), eq(activityEvents.entityId, task.id)))
      .orderBy(asc(activityEvents.createdAt), asc(activityEvents.id));
    const body: ActivityPage = {
      items: rows.flatMap((r) => {
        const action = activityActionSchema.safeParse(r.action);
        if (!action.success) return [];
        return [
          {
            id: r.id,
            action: action.data,
            field: r.field,
            old: r.old,
            new: r.new,
            actor: r.actorId
              ? {
                  id: r.actorId,
                  name: r.name ?? "",
                  avatarUrl: r.avatarFileId ? fileUrl(r.avatarFileId) : (r.image ?? null),
                }
              : null,
            createdAt: r.createdAt.toISOString(),
          },
        ];
      }),
    };
    return c.json(body);
  });
