import { blocks, inboxItems, tasks, type Executor } from "@flolist/db";
import {
  channel,
  createInboxTaskSchema,
  deleteInboxItemSchema,
  putInboxItemSchema,
  taskTitleText,
  type InboxItem,
  type InboxPage,
} from "@flolist/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { authorize } from "../authz/authorize.ts";
import { ApiException, unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation, type MutationScope } from "../sync/mutation.ts";
import { dbOf, type AppEnv } from "../types.ts";
import { emitTasks, labelIdsByTask, logActivity, patchTask, taskDto } from "../tasks/service.ts";

const taskIdParamSchema = z.object({ taskId: z.uuid() });

type InboxRow = typeof inboxItems.$inferSelect;

export function inboxItemDto(row: InboxRow): InboxItem {
  return {
    taskId: row.taskId,
    position: row.position,
    reason: row.reason,
    addedAt: row.addedAt.toISOString(),
    version: row.updatedAt.getTime(),
  };
}

export async function emitInboxItem(
  emit: MutationScope["emit"],
  userId: string,
  row: InboxRow,
): Promise<void> {
  const dto = inboxItemDto(row);
  await emit([channel.user(userId)], {
    op: "upsert",
    entity: "inboxItem",
    id: dto.taskId,
    version: dto.version,
    data: dto,
  });
}

/** Adds the task to the user's Inbox at `position`, or moves it there when it's in already. */
export async function putInboxItem(
  tx: Executor,
  emit: MutationScope["emit"],
  userId: string,
  taskId: string,
  position: string,
  reason: InboxItem["reason"],
): Promise<InboxRow> {
  const now = new Date();
  const [row] = await tx
    .insert(inboxItems)
    .values({ userId, taskId, position, reason, addedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [inboxItems.userId, inboxItems.taskId],
      set: { position, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("inbox upsert failed");
  await emitInboxItem(emit, userId, row);
  return row;
}

/** Live subtasks under `roots`, any depth (Inbox rows show them nested, views.md → Inbox). */
async function liveSubtasks(db: Executor, roots: readonly string[]) {
  const out: (typeof tasks.$inferSelect)[] = [];
  let frontier = [...roots];
  for (let depth = 0; frontier.length > 0 && depth < 16; depth += 1) {
    const rows = await db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.parentTaskId, frontier), isNull(tasks.deletedAt)));
    out.push(...rows);
    frontier = rows.map((r) => r.id);
  }
  return out;
}

/**
 * The caller's Inbox (views.md → Inbox). Completed tasks stay in it, so reopening one brings it
 * back; the view hides them unless "Hide completed" is off (D-075).
 */
export const inboxRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = dbOf(c);
    const user = c.get("user");
    if (!user) throw unauthenticated();
    const rows = await db
      .select({ item: inboxItems })
      .from(inboxItems)
      .innerJoin(tasks, eq(tasks.id, inboxItems.taskId))
      .where(and(eq(inboxItems.userId, user.id), isNull(tasks.deletedAt)))
      .orderBy(asc(inboxItems.position), asc(inboxItems.taskId));
    // Only items whose task the caller can still see (a list un-shared later, M7).
    const visible: InboxRow[] = [];
    const top: (typeof tasks.$inferSelect)[] = [];
    for (const { item } of rows) {
      try {
        const { task } = await authorize(db, user, "task.view", { type: "task", id: item.taskId });
        visible.push(item);
        top.push(task);
      } catch (e) {
        if (!(e instanceof ApiException) || e.code !== "NOT_FOUND") throw e;
      }
    }
    const subs = await liveSubtasks(
      db,
      top.map((t) => t.id),
    );
    const all = [...top, ...subs.filter((s) => !top.some((t) => t.id === s.id))];
    const ids = all.map((t) => t.id);
    const blockRows =
      ids.length === 0
        ? []
        : await db
            .select({ id: blocks.id, taskId: blocks.taskId, position: blocks.position })
            .from(blocks)
            .where(and(inArray(blocks.taskId, ids), isNull(blocks.deletedAt)));
    const blockOf = new Map(blockRows.map((b) => [b.taskId, b]));
    const labelsOf = await labelIdsByTask(db, ids);
    const positions: Record<string, string> = {};
    for (const s of subs) {
      const b = blockOf.get(s.id);
      if (b) positions[s.id] = b.position;
    }
    const body: InboxPage = {
      items: visible.map(inboxItemDto),
      tasks: all.map((t) => taskDto(t, blockOf.get(t.id)?.id ?? null, labelsOf.get(t.id) ?? [])),
      positions,
    };
    return c.json(body);
  })

  /** Creates a task in no list, straight into the caller's Inbox. */
  .post("/tasks", validate("json", createInboxTaskSchema), async (c) => {
    const input = c.req.valid("json");
    return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
      const { workspace } = await authorize(tx, user, "workspace.createTask", {
        type: "workspace",
        id: input.workspaceId,
      });
      const now = new Date();
      const title = taskTitleText(input.titleInline);
      const [created] = await tx
        .insert(tasks)
        .values({
          id: input.id,
          workspaceId: workspace.id,
          title,
          titleInline: input.titleInline,
          createdBy: user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ApiException("CONFLICT", "A task with this id already exists");
      await logActivity(tx, {
        task: created,
        actorId: user.id,
        action: "created",
        new: title,
        now,
      });
      const task =
        (await patchTask(
          tx,
          created,
          { due: input.due, priority: input.priority, labelIds: input.labelIds },
          user.id,
          now,
        )) ?? created;
      const item = await putInboxItem(tx, emit, user.id, task.id, input.position, "manual");
      await emitTasks(tx, emit, [task.id]);
      const labels = (await labelIdsByTask(tx, [task.id])).get(task.id) ?? [];
      return { status: 201, body: { task: taskDto(task, null, labels), item: inboxItemDto(item) } };
    });
  })

  /** Adds a task the caller can see to their Inbox (right-click → Add to Inbox), or reorders it. */
  .put(
    "/items/:taskId",
    validate("param", taskIdParamSchema),
    validate("json", putInboxItemSchema),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        await authorize(tx, user, "task.view", { type: "task", id: taskId });
        const item = await putInboxItem(tx, emit, user.id, taskId, input.position, "manual");
        return { status: 200, body: inboxItemDto(item) };
      });
    },
  )

  /**
   * Removes a task from the caller's Inbox. A task in no list can't leave it this way (it would
   * be reachable from nowhere): it leaves by moving to a list, or by being deleted (D-075).
   */
  .delete(
    "/items/:taskId",
    validate("param", taskIdParamSchema),
    validate("json", deleteInboxItemSchema),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { clientMutationId } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        const { task } = await authorize(tx, user, "task.view", { type: "task", id: taskId });
        if (!task.listId) {
          throw new ApiException("CONFLICT", "A task without a list stays in the Inbox");
        }
        const removed = await tx
          .delete(inboxItems)
          .where(and(eq(inboxItems.userId, user.id), eq(inboxItems.taskId, taskId)))
          .returning();
        for (const row of removed) {
          await emit([channel.user(user.id)], {
            op: "delete",
            entity: "inboxItem",
            id: taskId,
            version: row.updatedAt.getTime(),
          });
        }
        return { status: 200, body: { removed: removed.length > 0 } };
      });
    },
  );
