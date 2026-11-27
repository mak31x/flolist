import { labels, member, taskLabels, tasks, workspaces, type Executor } from "@flolist/db";
import {
  channel,
  createLabelSchema,
  deleteLabelSchema,
  idParamSchema,
  MAX_WORKSPACE_LABELS,
  updateLabelSchema,
  type Label,
  type LabelPage,
  type UpdateLabelResult,
  type WorkspaceAction,
} from "@flolist/shared";
import { and, asc, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize } from "../authz/authorize.ts";
import { ApiException, notFound, unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation, type MutationScope } from "../sync/mutation.ts";
import { touchTasks } from "../tasks/service.ts";
import { dbOf, type AppEnv, type AuthUser } from "../types.ts";

type LabelRow = typeof labels.$inferSelect;

/** Live tasks carrying each label. */
async function taskCounts(db: Executor, ids: readonly string[]) {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ labelId: taskLabels.labelId, n: count() })
    .from(taskLabels)
    .innerJoin(tasks, eq(tasks.id, taskLabels.taskId))
    .where(and(inArray(taskLabels.labelId, [...ids]), isNull(tasks.deletedAt)))
    .groupBy(taskLabels.labelId);
  for (const r of rows) out.set(r.labelId, r.n);
  return out;
}

function labelDto(row: LabelRow, taskCount: number): Label {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    color: row.color ?? null,
    taskCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function labelDtoOf(db: Executor, row: LabelRow) {
  return labelDto(row, (await taskCounts(db, [row.id])).get(row.id) ?? 0);
}

/** A label the caller may act on; one in a workspace they can't see is NOT_FOUND. */
async function authorizeLabel(
  db: Executor,
  user: AuthUser | null,
  action: WorkspaceAction,
  id: string,
) {
  const [label] = await db.select().from(labels).where(eq(labels.id, id)).for("update");
  if (!user) throw unauthenticated();
  if (!label) throw notFound("Label");
  await authorize(db, user, action, { type: "workspace", id: label.workspaceId });
  return label;
}

async function emitLabel(tx: Executor, emit: MutationScope["emit"], row: LabelRow) {
  const data = await labelDtoOf(tx, row);
  await emit([channel.workspace(row.workspaceId)], {
    op: "upsert",
    entity: "label",
    id: row.id,
    version: row.version,
    data,
  });
  return data;
}

const byName = (workspaceId: string, name: string) =>
  and(eq(labels.workspaceId, workspaceId), sql`lower(${labels.name}) = lower(${name})`);

export const labelRoutes = new Hono<AppEnv>()
  /**
   * Every label in the caller's workspaces, by name (Settings → Labels and the pickers). A
   * collection route: scoped to the caller's memberships instead of `authorize()` per row.
   */
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) throw unauthenticated();
    const db = dbOf(c);
    const rows = await db
      .select({ label: labels })
      .from(labels)
      .innerJoin(workspaces, eq(workspaces.id, labels.workspaceId))
      .leftJoin(
        member,
        and(eq(member.organizationId, workspaces.organizationId), eq(member.userId, user.id)),
      )
      .where(
        and(
          isNull(workspaces.deletedAt),
          or(
            and(eq(workspaces.kind, "personal"), eq(workspaces.ownerId, user.id)),
            and(eq(workspaces.kind, "team"), sql`${member.id} is not null`),
          ),
        ),
      )
      .orderBy(asc(sql`lower(${labels.name})`), asc(labels.id));
    const counts = await taskCounts(
      db,
      rows.map((r) => r.label.id),
    );
    const body: LabelPage = {
      items: rows.map((r) => labelDto(r.label, counts.get(r.label.id) ?? 0)),
    };
    return c.json(body);
  })

  /** Creates a label, or answers the existing one with that name (200) so Enter always works. */
  .post("/", validate("json", createLabelSchema), async (c) => {
    const input = c.req.valid("json");
    return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
      await authorize(tx, user, "workspace.useLabels", {
        type: "workspace",
        id: input.workspaceId,
      });
      // Serialize creates per workspace so the name check and the limit hold.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`labels:${input.workspaceId}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(labels)
        .where(byName(input.workspaceId, input.name));
      if (existing) return { status: 200, body: await labelDtoOf(tx, existing) };
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(labels)
        .where(eq(labels.workspaceId, input.workspaceId));
      if (n >= MAX_WORKSPACE_LABELS) {
        throw new ApiException(
          "LIMIT",
          `A workspace holds at most ${String(MAX_WORKSPACE_LABELS)} labels`,
        );
      }
      const [row] = await tx
        .insert(labels)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          name: input.name,
          color: input.color ?? null,
          createdBy: user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ApiException("CONFLICT", "A label with this id already exists");
      return { status: 201, body: await emitLabel(tx, emit, row) };
    });
  })

  /**
   * Renames or recolours a label. Renaming it to another label's name (ignoring case) merges it
   * into that one: its tasks get the other label and this one is deleted.
   */
  .patch(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateLabelSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const label = await authorizeLabel(tx, user, "workspace.manageLabels", id);
        const target =
          input.name === undefined
            ? undefined
            : (
                await tx
                  .select()
                  .from(labels)
                  .where(and(byName(label.workspaceId, input.name), ne(labels.id, label.id)))
                  .for("update")
              )[0];

        if (target) {
          const moved = await tx
            .select({ taskId: taskLabels.taskId, createdAt: taskLabels.createdAt })
            .from(taskLabels)
            .where(eq(taskLabels.labelId, label.id));
          if (moved.length > 0) {
            await tx
              .insert(taskLabels)
              .values(
                moved.map((m) => ({
                  taskId: m.taskId,
                  labelId: target.id,
                  createdAt: m.createdAt,
                })),
              )
              .onConflictDoNothing();
          }
          await tx.delete(labels).where(eq(labels.id, label.id));
          const [merged = target] = await tx
            .update(labels)
            .set({
              ...(input.color !== undefined ? { color: input.color } : {}),
              version: sql`${labels.version} + 1`,
            })
            .where(eq(labels.id, target.id))
            .returning();
          await emit([channel.workspace(label.workspaceId)], {
            op: "delete",
            entity: "label",
            id: label.id,
            version: label.version + 1,
          });
          const data = await emitLabel(tx, emit, merged);
          await touchTasks(
            tx,
            emit,
            moved.map((m) => m.taskId),
          );
          const body: UpdateLabelResult = { label: data, mergedFrom: label.id };
          return { status: 200, body };
        }

        const [updated = label] = await tx
          .update(labels)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            version: sql`${labels.version} + 1`,
          })
          .where(eq(labels.id, label.id))
          .returning();
        const body: UpdateLabelResult = {
          label: await emitLabel(tx, emit, updated),
          mergedFrom: null,
        };
        return { status: 200, body };
      });
    },
  )

  /** Deletes a label and removes it from every task. */
  .delete(
    "/:id",
    validate("param", idParamSchema),
    validate("json", deleteLabelSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const label = await authorizeLabel(tx, user, "workspace.manageLabels", id);
        const affected = await tx
          .select({ taskId: taskLabels.taskId })
          .from(taskLabels)
          .where(eq(taskLabels.labelId, label.id));
        await tx.delete(labels).where(eq(labels.id, label.id));
        await emit([channel.workspace(label.workspaceId)], {
          op: "delete",
          entity: "label",
          id: label.id,
          version: label.version + 1,
        });
        await touchTasks(
          tx,
          emit,
          affected.map((a) => a.taskId),
        );
        return { status: 200, body: { id: label.id } };
      });
    },
  );
