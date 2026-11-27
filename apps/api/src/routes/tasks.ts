import { activityEvents, blocks, tasks, user as users, type Executor } from "@flolist/db";
import {
  activityActionSchema,
  channel,
  fileUrl,
  idParamSchema,
  updateTaskSchema,
  type ActivityPage,
  type ListAction,
} from "@flolist/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize } from "../authz/authorize.ts";
import { blockDtos } from "../blocks/dto.ts";
import { notFound, unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { dbOf, type AppEnv, type AuthUser } from "../types.ts";
import { emitTasks, patchTask, taskDtoOf } from "../tasks/service.ts";

/**
 * A live task the caller may act on. Access is its home list's (D-045's rule for blocks, so
 * there are no task actions in the matrix yet); a task the caller can't see is NOT_FOUND.
 * Inbox-only tasks (no list) arrive with M4.1.
 */
async function authorizeTask(
  db: Executor,
  user: AuthUser | null,
  action: ListAction,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));
  const [task] = lock ? await query.for("update") : await query;
  if (!user) throw unauthenticated();
  if (!task?.listId) throw notFound("Task");
  const access = await authorize(db, user, action, { type: "list", id: task.listId });
  return { ...access, task };
}

async function blockOf(db: Executor, taskId: string) {
  const [row] = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.taskId, taskId), isNull(blocks.deletedAt)));
  return row ?? null;
}

export const taskRoutes = new Hono<AppEnv>()
  /** The task as the details panel shows it. */
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const db = dbOf(c);
    const { task } = await authorizeTask(db, c.get("user"), "list.view", c.req.valid("param").id);
    const block = await blockOf(db, task.id);
    return c.json(await taskDtoOf(db, task, block?.id ?? null));
  })

  /**
   * Changes the title, completion, due date, priority or labels (field-level LWW, D-006) from
   * places without the
   * list's block store (the details panel header now, Inbox/Today later). The task block's
   * content follows the title in the same transaction.
   */
  .patch(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateTaskSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const { task, root } = await authorizeTask(tx, user, "list.edit", id, true);
        const now = new Date();
        const updated =
          (await patchTask(
            tx,
            task,
            {
              inline: input.titleInline,
              completed: input.completed,
              due: input.due,
              priority: input.priority,
              labelIds: input.labelIds,
            },
            user.id,
            now,
          )) ?? task;
        let block = await blockOf(tx, task.id);
        if (block && updated !== task) {
          const [changed] = await tx
            .update(blocks)
            .set({
              ...(input.titleInline ? { content: { inline: input.titleInline } } : {}),
              version: sql`${blocks.version} + 1`,
            })
            .where(eq(blocks.id, block.id))
            .returning();
          block = changed ?? block;
          const [dto] = await blockDtos(tx, [block]);
          if (dto) {
            await emit([channel.list(root.id)], {
              op: "upsert",
              entity: "block",
              id: dto.id,
              version: dto.version,
              data: dto,
            });
          }
        }
        if (updated !== task) await emitTasks(tx, emit, [task.id]);
        return { status: 200, body: await taskDtoOf(tx, updated, block?.id ?? null) };
      });
    },
  )

  /** The activity log, oldest first (tasks.md → Activity log). */
  .get("/:id/activity", validate("param", idParamSchema), async (c) => {
    const db = dbOf(c);
    const { task } = await authorizeTask(db, c.get("user"), "list.view", c.req.valid("param").id);
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
