import { blocks, lists, tasks, type Executor } from "@flolist/db";
import {
  blockBatchSchema,
  channel,
  moveBlocksToSchema,
  positionAfter,
  positionsBetween,
  idParamSchema,
  type BlockBatchResult,
  type BlockPage,
} from "@flolist/shared";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize } from "../authz/authorize.ts";
import { applyBlockBatch, type BatchPage } from "../blocks/batch.ts";
import { blockDtos, type BlockRow } from "../blocks/dto.ts";
import type { ListRow } from "../authz/authorize.ts";
import { ApiException, notFound } from "../lib/errors.ts";
import { listChannels, listDto } from "../lists/dto.ts";
import { subtreeIds } from "../lists/tree.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { emitTasks, logActivity, taskSubtreeIds } from "../tasks/service.ts";
import { dbOf, type AppEnv } from "../types.ts";

/** The batch page of a list (D-056): its blocks and the bodies of the tasks that live in it. */
function listBatchPage(root: ListRow, listId: string): BatchPage {
  return {
    listId,
    rootListId: root.id,
    workspaceId: root.workspaceId,
    top: { type: "list", id: listId },
    blockChannels: [channel.list(root.id)],
    listChannels: listChannels(root),
  };
}

/** Blocks of a list page: the list's own, and the bodies of the tasks that live in it. */
const inPage = (listId: string) =>
  or(
    and(eq(blocks.containerType, "list"), eq(blocks.containerId, listId)),
    and(
      eq(blocks.containerType, "task"),
      inArray(
        blocks.containerId,
        sql`(select ${tasks.id} from ${tasks} where ${tasks.listId} = ${listId} and ${tasks.deletedAt} is null)`,
      ),
    ),
  );

/**
 * `rows` in the order the list page shows them: each block's path of positions from the list
 * (its parent tasks' blocks, then its own), compared byte-wise (D-041).
 */
async function inPageOrder(tx: Executor, rows: BlockRow[]): Promise<BlockRow[]> {
  const blockOfTask = new Map<string, BlockRow | null>();
  async function path(row: BlockRow): Promise<string[]> {
    const own = [row.position, row.id];
    if (row.containerType !== "task") return own;
    let parent = blockOfTask.get(row.containerId);
    if (parent === undefined) {
      const [found] = await tx
        .select()
        .from(blocks)
        .where(and(eq(blocks.taskId, row.containerId), isNull(blocks.deletedAt)));
      parent = found ?? null;
      blockOfTask.set(row.containerId, parent);
    }
    return parent ? [...(await path(parent)), ...own] : own;
  }
  const keyed = await Promise.all(rows.map(async (row) => ({ row, key: await path(row) })));
  const cmp = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const x = a[i] ?? "";
      const y = b[i] ?? "";
      if (x !== y) return x < y ? -1 : 1;
    }
    return a.length - b.length;
  };
  return keyed.sort((a, b) => cmp(a.key, b.key)).map((k) => k.row);
}

export const blockRoutes = new Hono<AppEnv>()
  /**
   * The list's live blocks in order (D-007), plus the bodies of its tasks (subtasks render
   * nested, and the details panel edits a body with the same store). Sublists (M2.3) are their
   * own pages.
   */
  .get("/:id/blocks", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = dbOf(c);
    await authorize(db, c.get("user"), "list.view", { type: "list", id });
    const rows = await db
      .select()
      .from(blocks)
      .where(and(inPage(id), isNull(blocks.deletedAt)))
      .orderBy(asc(blocks.position), asc(blocks.id));
    const body: BlockPage = { items: await blockDtos(db, rows) };
    return c.json(body);
  })

  /** Applies one editor command to the list page atomically (`applyBlockBatch`). */
  .post(
    "/:id/blocks/batch",
    validate("param", idParamSchema),
    validate("json", blockBatchSchema),
    async (c) => {
      const { id: listId } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async (scope) => {
        const { tx } = scope;
        const { root } = await authorize(tx, scope.user, "list.edit", { type: "list", id: listId });
        const body = await applyBlockBatch(scope, listBatchPage(root, listId), input.ops);
        return { status: 200, body };
      });
    },
  )
  /**
   * Moves blocks into another list (a drop on a sublist row or a sidebar list, D-047; Move to
   * list…, M3.3). They keep their page order and go to the end of the target. The ids are
   * blocks of the list's page: its own blocks, or subtask blocks in the bodies of its tasks,
   * which become top-level tasks of the target. A subtask whose parent task is moved too goes
   * along inside it. A sublist block takes its child lists along. Both lists must be editable
   * and in the same workspace, and a sublist can't be dropped into itself or its own
   * sublists. Each moved task logs `moved`. Not undoable [assumption].
   */
  .post(
    "/:id/blocks/move-to",
    validate("param", idParamSchema),
    validate("json", moveBlocksToSchema),
    async (c) => {
      const { id: listId } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const source = await authorize(tx, user, "list.edit", { type: "list", id: listId });
        const target = await authorize(tx, user, "list.edit", {
          type: "list",
          id: input.targetListId,
        });
        if (target.list.id === listId) {
          throw new ApiException("VALIDATION", "The blocks are already in this list");
        }
        if (target.list.workspaceId !== source.list.workspaceId) {
          throw new ApiException("VALIDATION", "Blocks can only move within one workspace");
        }
        const found = await tx
          .select()
          .from(blocks)
          .where(and(inArray(blocks.id, input.ids), isNull(blocks.deletedAt)))
          .for("update");
        const parentIds = found.filter((r) => r.containerType === "task").map((r) => r.containerId);
        const parents =
          parentIds.length > 0
            ? await tx
                .select({ id: tasks.id })
                .from(tasks)
                .where(
                  and(
                    inArray(tasks.id, parentIds),
                    eq(tasks.listId, listId),
                    isNull(tasks.deletedAt),
                  ),
                )
            : [];
        const onPage = new Set(parents.map((p) => p.id));
        const byId = new Map(
          found
            .filter((r) =>
              r.containerType === "list"
                ? r.containerId === listId
                : r.taskId !== null && onPage.has(r.containerId),
            )
            .map((r) => [r.id, r]),
        );
        if (byId.size !== input.ids.length) throw notFound("Block");
        const ordered = await inPageOrder(tx, [...byId.values()]);
        // Subtasks of a moved task travel inside it.
        const carried = new Set<string>();
        for (const row of ordered) {
          if (!row.taskId) continue;
          for (const id of await taskSubtreeIds(tx, row.taskId)) {
            if (id !== row.taskId) carried.add(id);
          }
        }
        const rows = ordered.filter((r) => !(r.taskId && carried.has(r.taskId)));

        const movedLists: string[] = [];
        for (const row of rows) {
          if (!row.sublistId) continue;
          const tree = await subtreeIds(tx, row.sublistId);
          if (tree.includes(target.list.id)) {
            throw new ApiException("VALIDATION", "A sublist can't move into itself");
          }
          movedLists.push(...tree);
        }

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
        const positions =
          rows.length === 1
            ? [positionAfter(last?.position ?? null)]
            : positionsBetween(last?.position ?? null, null, rows.length);

        const moved: BlockRow[] = [];
        for (const [i, row] of rows.entries()) {
          const [updated] = await tx
            .update(blocks)
            .set({
              containerType: "list",
              containerId: target.list.id,
              rootListId: target.root.id,
              position: positions[i] ?? positionAfter(null),
              indent: 0,
              version: sql`${blocks.version} + 1`,
            })
            .where(eq(blocks.id, row.id))
            .returning();
          if (!updated) throw new Error(`block ${row.id} vanished during move`);
          moved.push(updated);
        }

        // Tasks follow: the moved tasks and their subtasks get the target as home list, and
        // their bodies move to the target's root.
        const movedTasks: string[] = [];
        for (const row of rows) {
          if (row.taskId) movedTasks.push(...(await taskSubtreeIds(tx, row.taskId)));
        }
        const promoted = rows.flatMap((r) =>
          r.containerType === "task" && r.taskId ? [r.taskId] : [],
        );
        if (promoted.length > 0) {
          await tx.update(tasks).set({ parentTaskId: null }).where(inArray(tasks.id, promoted));
        }
        const now = new Date();
        for (const row of rows) {
          if (!row.taskId) continue;
          await logActivity(tx, {
            task: {
              id: row.taskId,
              workspaceId: target.list.workspaceId,
              rootListId: target.root.id,
            },
            actorId: user.id,
            action: "moved",
            field: "list",
            old: { id: source.list.id, title: source.list.title },
            new: { id: target.list.id, title: target.list.title },
            now,
          });
        }
        const bodies: BlockRow[] = [];
        if (movedTasks.length > 0) {
          await tx
            .update(tasks)
            .set({
              listId: target.list.id,
              rootListId: target.root.id,
              version: sql`${tasks.version} + 1`,
            })
            .where(inArray(tasks.id, movedTasks));
          bodies.push(
            ...(await tx
              .update(blocks)
              .set({ rootListId: target.root.id, version: sql`${blocks.version} + 1` })
              .where(
                and(
                  eq(blocks.containerType, "task"),
                  inArray(blocks.containerId, movedTasks),
                  isNull(blocks.deletedAt),
                ),
              )
              .returning()),
          );
        }

        // Child lists follow: direct children hang under the target, all move to its root.
        if (movedLists.length > 0) {
          const direct = new Set(rows.map((r) => r.sublistId).filter((x) => x !== null));
          await tx
            .update(lists)
            .set({
              rootListId: target.root.id,
              parentListId: sql`case when ${lists.id} in (${sql.join(
                [...direct].map((d) => sql`${d}::uuid`),
                sql`, `,
              )}) then ${target.list.id}::uuid else ${lists.parentListId} end`,
              version: sql`${lists.version} + 1`,
            })
            .where(inArray(lists.id, movedLists));
          await tx
            .update(blocks)
            .set({ rootListId: target.root.id })
            .where(and(eq(blocks.containerType, "list"), inArray(blocks.containerId, movedLists)));
          // Tasks of the moved sublists keep their home list; only the root changes.
          const sublistTasks = await tx
            .update(tasks)
            .set({ rootListId: target.root.id, version: sql`${tasks.version} + 1` })
            .where(inArray(tasks.listId, movedLists))
            .returning({ id: tasks.id });
          if (sublistTasks.length > 0) {
            await tx
              .update(blocks)
              .set({ rootListId: target.root.id })
              .where(
                and(
                  eq(blocks.containerType, "task"),
                  inArray(
                    blocks.containerId,
                    sublistTasks.map((t) => t.id),
                  ),
                ),
              );
            movedTasks.push(...sublistTasks.map((t) => t.id));
          }
          const updatedLists = await tx.select().from(lists).where(inArray(lists.id, movedLists));
          for (const l of updatedLists) {
            await emit(listChannels(target.root), {
              op: "upsert",
              entity: "list",
              id: l.id,
              version: l.version,
              data: listDto(l),
            });
          }
        }

        // Deletes first, so caches of the source list drop the rows the upserts re-add elsewhere.
        // They carry the source copy's version (before the move bumped it): a client that
        // already holds the moved row (the move's own answer) keeps it (D-075).
        for (const row of [...moved, ...bodies]) {
          await emit([channel.list(source.root.id)], {
            op: "delete",
            entity: "block",
            id: row.id,
            version: row.version - 1,
          });
        }
        const dtos = await blockDtos(tx, [...moved, ...bodies]);
        for (const dto of dtos) {
          await emit([channel.list(target.root.id)], {
            op: "upsert",
            entity: "block",
            id: dto.id,
            version: dto.version,
            data: dto,
          });
        }
        await emitTasks(tx, emit, movedTasks);
        const body: BlockBatchResult = { blocks: dtos, deleted: [] };
        return { status: 200, body };
      });
    },
  );
