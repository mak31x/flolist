import { blocks, files, lists, tasks, type Executor } from "@flolist/db";
import {
  isInlineImage,
  isMediaBlockType,
  MAX_SUBTASK_DEPTH,
  resolveBlockShape,
  taskTitleInlineSchema,
  taskTitleText,
  type BlockBatchResult,
  type BlockContainer,
  type BlockContent,
  type BlockFileMeta,
  type BlockOp,
  type BlockShape,
  type InlineNode,
  type MediaContent,
  type TextContent,
  type UpsertBlockOp,
} from "@flolist/shared";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { ApiException, notFound } from "../lib/errors.ts";
import { listDto } from "../lists/dto.ts";
import { subtreeIds } from "../lists/tree.ts";
import type { MutationScope } from "../sync/mutation.ts";
import {
  emitTasks,
  logActivity,
  patchTask,
  restoreTaskTree,
  trashTaskTree,
} from "../tasks/service.ts";
import { blockDtos, type BlockRow } from "./dto.ts";

/**
 * The page a block batch edits (D-056): a list page (the list's blocks and the bodies of the
 * tasks that live in it) or, for a task in no list (Inbox-only, M4.1), that task's body page
 * (its body and the bodies of its subtasks). Access is checked by the caller.
 */
export interface BatchPage {
  /** The list of a list page; null on a task page. */
  listId: string | null;
  /** The root list (access, channel); null on a task page. */
  rootListId: string | null;
  workspaceId: string;
  /** Where a block without `container` goes: the list, or the page's task. */
  top: BlockContainer;
  /** Channels of block events. */
  blockChannels: string[];
  /** Channels of list events (sublists); empty on a task page. */
  listChannels: string[];
}

export const invalid = (message: string, index: number) =>
  new ApiException("VALIDATION", message, {
    details: [{ source: "json", path: ["ops", index], message }],
  });

export function resolveShape(
  index: number,
  current: BlockShape | null,
  fields: Parameters<typeof resolveBlockShape>[1],
): BlockShape {
  const result = resolveBlockShape(current, fields);
  if (!result.ok) throw invalid(result.error, index);
  return result.shape;
}

/** A row's content was validated on write (`blockDto` re-checks it on the way out). */
export const shapeOf = (row: BlockRow) => ({
  type: row.type,
  indent: row.indent,
  content: row.content as BlockContent,
});

/** Every task whose body belongs to the page, trashed ones too (undo can restore them). */
async function pageTaskRows(tx: Executor, page: BatchPage) {
  if (page.listId) {
    return tx
      .select({ id: tasks.id, parentTaskId: tasks.parentTaskId, deletedAt: tasks.deletedAt })
      .from(tasks)
      .where(eq(tasks.listId, page.listId));
  }
  const result = await tx.execute<{
    id: string;
    parent_task_id: string | null;
    deleted_at: Date | null;
  }>(sql`
    with recursive tree(id, parent_task_id, deleted_at, hops) as (
      select ${tasks.id}, ${tasks.parentTaskId}, ${tasks.deletedAt}, 0 from ${tasks}
      where ${tasks.id} = ${page.top.id} and ${tasks.listId} is null
      union all
      select t.id, t.parent_task_id, t.deleted_at, tree.hops + 1
      from ${tasks} t join tree on t.parent_task_id = tree.id
      where t.list_id is null and tree.hops < 16
    )
    select id, parent_task_id, deleted_at from tree
  `);
  return result.rows.map((r) => ({
    id: r.id,
    parentTaskId: r.parent_task_id,
    deletedAt: r.deleted_at,
  }));
}

/**
 * Applies one editor command atomically: upserts (create, or change only the sent fields;
 * field-level LWW, D-006), moves and soft deletes. An upsert of a soft-deleted block of this
 * page restores it, which is how undo brings a deleted block back. Deleting a block that is
 * already gone is a no-op, so two clients deleting the same block don't conflict.
 *
 * Image/attachment blocks name a ready file of the page's workspace (`fileId`); the server
 * fills `content.file` from it. A new sublist block creates its child list in the same
 * transaction; deleting the block sends the child lists to Trash with it (trash root = the
 * block), and restoring the block brings them back.
 */
export async function applyBlockBatch(
  { tx, user, emit }: MutationScope,
  page: BatchPage,
  ops: readonly BlockOp[],
): Promise<BlockBatchResult> {
  const ids = ops.map((op) => op.id);
  const existing = new Map<string, BlockRow>();
  for (const row of await tx.select().from(blocks).where(inArray(blocks.id, ids)).for("update")) {
    existing.set(row.id, row);
  }

  // The tasks whose bodies belong to this page.
  const pageTasks = new Map<string, { parentTaskId: string | null; live: boolean }>();
  for (const t of await pageTaskRows(tx, page)) {
    pageTasks.set(t.id, { parentTaskId: t.parentTaskId, live: t.deletedAt === null });
  }
  const inThisPage = (row: BlockRow | undefined): row is BlockRow =>
    row !== undefined &&
    (row.containerType === "list"
      ? row.containerId === page.listId
      : pageTasks.has(row.containerId));

  /** Sublists live only on list pages (a task can't hold one). */
  function listPageRoot(index: number): string {
    if (!page.rootListId) throw invalid("A task can't hold a sublist", index);
    return page.rootListId;
  }

  /** Top-level tasks are depth 1, their subtasks 2, … */
  const depthOf = (taskId: string) => {
    let depth = 0;
    for (let cur: string | null = taskId; cur && depth <= MAX_SUBTASK_DEPTH; depth++) {
      cur = pageTasks.get(cur)?.parentTaskId ?? null;
    }
    return depth;
  };
  /** Levels in a task's tree, the task itself included. */
  const heightOf = (taskId: string): number => {
    let max = 0;
    for (const [child, t] of pageTasks) {
      if (t.parentTaskId === taskId && t.live) max = Math.max(max, heightOf(child));
    }
    return max + 1;
  };

  const changed = new Map<string, BlockRow>();
  const deleted: string[] = [];
  const touchedTasks = new Set<string>();
  const now = new Date();

  function containerOf(index: number, container: BlockContainer | undefined) {
    if (!container) return page.top;
    if (container.type === "list" && container.id === page.listId) {
      return { type: "list" as const, id: container.id };
    }
    if (container.type === "task" && pageTasks.get(container.id)?.live) {
      return { type: "task" as const, id: container.id };
    }
    throw invalid("The container isn't a task on this page", index);
  }

  function titleOf(index: number, content: BlockContent): InlineNode[] {
    const parsed = taskTitleInlineSchema.safeParse((content as TextContent).inline);
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Bad title", index);
    return parsed.data;
  }

  async function fileMeta(index: number, fileId: string, image: boolean) {
    const [file] = await tx.select().from(files).where(eq(files.id, fileId));
    if (file?.status !== "ready" || file.workspaceId !== page.workspaceId) {
      throw invalid("The file doesn't exist or isn't uploaded yet", index);
    }
    if (image && !isInlineImage(file.mime)) {
      throw invalid("An image block needs a JPEG, PNG, WebP or GIF file", index);
    }
    const meta: BlockFileMeta = {
      name: file.filename,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      width: file.width,
      height: file.height,
    };
    return meta;
  }

  /** Soft-deletes (or restores) the lists below a sublist block, emitting their events. */
  async function setSublistTrash(block: BlockRow, trashed: boolean) {
    if (!block.sublistId) return;
    const ids = trashed
      ? await subtreeIds(tx, block.sublistId)
      : (
          await tx
            .select({ id: lists.id })
            .from(lists)
            .where(and(eq(lists.trashRootId, block.id), isNotNull(lists.deletedAt)))
        ).map((r) => r.id);
    if (ids.length === 0) return;
    const rows = await tx
      .update(lists)
      .set(
        trashed
          ? { deletedAt: now, deletedBy: user.id, trashRootId: block.id }
          : { deletedAt: null, deletedBy: null, trashRootId: null },
      )
      .where(inArray(lists.id, ids))
      .returning();
    for (const row of rows) {
      await emit(
        page.listChannels,
        trashed
          ? { op: "delete", entity: "list", id: row.id, version: row.version }
          : {
              op: "upsert",
              entity: "list",
              id: row.id,
              version: row.version,
              data: listDto(row),
            },
      );
    }
  }

  /** A task tree went to Trash or came back: track its body blocks and tasks. */
  function noteBodies(rows: BlockRow[], trashed: boolean) {
    for (const row of rows) {
      existing.set(row.id, row);
      if (trashed) {
        changed.delete(row.id);
        deleted.push(row.id);
      } else {
        changed.set(row.id, row);
      }
      if (row.taskId) touchedTasks.add(row.taskId);
    }
  }

  async function refreshPageTasks() {
    for (const t of await pageTaskRows(tx, page)) {
      pageTasks.set(t.id, { parentTaskId: t.parentTaskId, live: t.deletedAt === null });
    }
  }

  async function trashTask(taskId: string, trashRootId: string) {
    touchedTasks.add(taskId);
    noteBodies(await trashTaskTree(tx, taskId, trashRootId, user.id, now), true);
    await refreshPageTasks();
  }

  async function restoreTask(taskId: string, trashRootId: string) {
    touchedTasks.add(taskId);
    noteBodies(await restoreTaskTree(tx, trashRootId), false);
    await refreshPageTasks();
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (task) await logActivity(tx, { task, actorId: user.id, action: "restored", now });
  }

  async function createTask(
    index: number,
    taskId: string,
    container: BlockContainer,
    inline: InlineNode[],
    completed: boolean,
  ) {
    const parentTaskId = container.type === "task" ? container.id : null;
    if (parentTaskId && depthOf(parentTaskId) + 1 > MAX_SUBTASK_DEPTH) {
      throw invalid("Subtasks can't nest any deeper", index);
    }
    const title = taskTitleText(inline);
    const [task] = await tx
      .insert(tasks)
      .values({
        id: taskId,
        workspaceId: page.workspaceId,
        rootListId: page.rootListId,
        listId: page.listId,
        parentTaskId,
        title,
        titleInline: inline,
        ...(completed ? { completedAt: now, completedBy: user.id } : {}),
        createdBy: user.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!task) throw new ApiException("CONFLICT", "A task with this id already exists");
    pageTasks.set(task.id, { parentTaskId, live: true });
    touchedTasks.add(task.id);
    await logActivity(tx, { task, actorId: user.id, action: "created", new: title, now });
  }

  /** The block's new container (Tab / Shift+Tab, drags between containers). */
  async function containerPatch(
    index: number,
    row: BlockRow,
    container: BlockContainer,
  ): Promise<Partial<typeof blocks.$inferInsert>> {
    if (container.type === row.containerType && container.id === row.containerId) return {};
    const target = containerOf(index, container);
    if (target.type === "task" && row.type === "sublist") {
      throw invalid("A task can't hold a sublist", index);
    }
    if (row.taskId) {
      if (target.type === "task") {
        for (let cur: string | null = target.id; cur;) {
          if (cur === row.taskId) throw invalid("A task can't go inside itself", index);
          cur = pageTasks.get(cur)?.parentTaskId ?? null;
        }
        if (depthOf(target.id) + heightOf(row.taskId) > MAX_SUBTASK_DEPTH) {
          throw invalid("Subtasks can't nest any deeper", index);
        }
      }
      const parentTaskId = target.type === "task" ? target.id : null;
      await tx
        .update(tasks)
        .set({ parentTaskId, version: sql`${tasks.version} + 1` })
        .where(eq(tasks.id, row.taskId));
      pageTasks.set(row.taskId, { parentTaskId, live: true });
      touchedTasks.add(row.taskId);
    }
    return { containerType: target.type, containerId: target.id };
  }

  /** Title, completion and the other fields of a task block's task. */
  async function updateTask(
    index: number,
    taskId: string,
    content: BlockContent | undefined,
    fields: UpsertBlockOp["task"],
  ) {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (!task) throw new Error(`task ${taskId} missing`);
    const inline = content ? titleOf(index, content) : undefined;
    const change = {
      inline,
      completed: fields?.completed,
      due: fields?.due,
      priority: fields?.priority,
      labelIds: fields?.labelIds,
    };
    if (await patchTask(tx, task, change, user.id, now)) {
      touchedTasks.add(taskId);
    }
  }

  for (const [index, op] of ops.entries()) {
    const row = existing.get(op.id);
    if (row && !inThisPage(row)) {
      // Ids are client-made UUIDv7s; a clash with another container is never legitimate.
      throw op.op === "upsert"
        ? new ApiException("CONFLICT", "A block with this id already exists")
        : notFound("Block");
    }
    const result = await applyOp(index, op, row);
    if (result === "deleted") {
      changed.delete(op.id);
      deleted.push(op.id);
    } else if (result) {
      existing.set(result.id, result);
      changed.set(result.id, result);
    }
  }

  async function applyOp(
    index: number,
    op: BlockOp,
    row: BlockRow | undefined,
  ): Promise<BlockRow | "deleted" | null> {
    switch (op.op) {
      case "delete": {
        if (!row || row.deletedAt) return null;
        const [gone] = await tx
          .update(blocks)
          .set({
            deletedAt: now,
            deletedBy: user.id,
            trashRootId: row.id,
            version: sql`${blocks.version} + 1`,
          })
          .where(eq(blocks.id, row.id))
          .returning();
        if (!gone) throw new Error(`block ${row.id} vanished during delete`);
        existing.set(gone.id, gone);
        await setSublistTrash(gone, true);
        if (gone.taskId) await trashTask(gone.taskId, gone.id);
        return "deleted";
      }
      case "move": {
        if (!row || row.deletedAt) throw notFound("Block");
        const shape = resolveShape(index, shapeOf(row), { indent: op.indent });
        const patch: Partial<typeof blocks.$inferInsert> = {
          position: op.position,
          indent: shape.indent,
        };
        if (op.container) Object.assign(patch, await containerPatch(index, row, op.container));
        return update(row.id, patch);
      }
      case "upsert": {
        if (!row) {
          if (!op.position) throw invalid("A new block needs a type and a position", index);
          const shape = resolveShape(index, null, op);
          const container = containerOf(index, op.container);
          const media = isMediaBlockType(shape.type);
          if (media !== (op.fileId !== undefined)) {
            throw invalid(
              media ? "A new media block needs a file" : "Only media blocks take a file",
              index,
            );
          }
          if ((shape.type === "sublist") !== (op.sublist !== undefined)) {
            throw invalid(
              op.sublist ? "Only sublist blocks take a sublist" : "A sublist block needs a list",
              index,
            );
          }
          if (shape.type === "sublist" && container.type === "task") {
            throw invalid("A task can't hold a sublist", index);
          }
          const taskId = shape.type === "task" ? op.task?.id : undefined;
          if (shape.type === "task" && !taskId) {
            throw invalid("A new task block needs a task id", index);
          }
          if (shape.type !== "task" && op.task) {
            throw invalid("Only task blocks take a task", index);
          }
          if (op.fileId) {
            shape.content = {
              caption: (shape.content as MediaContent).caption,
              file: await fileMeta(index, op.fileId, shape.type === "image"),
            };
          }
          let sublist: typeof lists.$inferSelect | undefined;
          if (op.sublist) {
            [sublist] = await tx
              .insert(lists)
              .values({
                id: op.sublist.id,
                workspaceId: page.workspaceId,
                rootListId: listPageRoot(index),
                parentListId: page.listId,
                title: op.sublist.title.trim(),
                createdBy: user.id,
              })
              .onConflictDoNothing()
              .returning();
            if (!sublist) {
              throw new ApiException("CONFLICT", "A list with this id already exists");
            }
          }
          if (taskId) {
            await createTask(
              index,
              taskId,
              container,
              titleOf(index, shape.content),
              op.task?.completed ?? false,
            );
            const { due, priority, labelIds } = op.task ?? {};
            if (due !== undefined || priority !== undefined || labelIds !== undefined) {
              await updateTask(index, taskId, undefined, { due, priority, labelIds });
            }
          }
          const [created] = await tx
            .insert(blocks)
            .values({
              id: op.id,
              containerType: container.type,
              containerId: container.id,
              rootListId: page.rootListId,
              position: op.position,
              ...shape,
              fileId: op.fileId ?? null,
              sublistId: sublist?.id ?? null,
              taskId: taskId ?? null,
              createdBy: user.id,
            })
            .onConflictDoNothing()
            .returning();
          if (!created) throw new ApiException("CONFLICT", "A block with this id already exists");
          if (sublist) {
            const [linked] = await tx
              .update(lists)
              .set({ parentBlockId: created.id })
              .where(eq(lists.id, sublist.id))
              .returning();
            if (!linked) throw new Error("sublist vanished");
            await emit(page.listChannels, {
              op: "upsert",
              entity: "list",
              id: linked.id,
              version: linked.version,
              data: listDto(linked),
            });
          }
          return created;
        }
        // Resending the same sublist (a client restoring the block) is fine; the title is
        // ignored, since it lives on the list.
        if (op.sublist && op.sublist.id !== row.sublistId) {
          throw invalid("A block's sublist can't change", index);
        }
        const shape = resolveShape(index, shapeOf(row), op);
        if (op.fileId && !isMediaBlockType(shape.type)) {
          throw invalid("Only media blocks take a file", index);
        }
        if (op.task && shape.type !== "task") {
          throw invalid("Only task blocks take a task", index);
        }
        if (row.taskId && op.task?.id && op.task.id !== row.taskId) {
          throw invalid("A block's task can't change", index);
        }
        const fileId = op.fileId ?? row.fileId;
        if (isMediaBlockType(shape.type)) {
          // The file's details always come from the file row, never from the client.
          const current = (row.content as { file?: BlockFileMeta | null }).file ?? null;
          shape.content = {
            caption: (shape.content as MediaContent).caption,
            file:
              op.fileId && op.fileId !== row.fileId
                ? await fileMeta(index, op.fileId, shape.type === "image")
                : fileId
                  ? current
                  : null,
          };
        }
        const restored = row.deletedAt !== null;
        if (restored) {
          // Restore first: the block's own row comes back below, its tree here.
          if (row.taskId) await restoreTask(row.taskId, row.id);
        }

        let taskId = row.taskId;
        if (row.taskId && shape.type !== "task") {
          // Turned into text: the task (and its body) goes to Trash with this block as
          // its root, so turning it back into a task (undo) restores it.
          await trashTask(row.taskId, row.id);
          taskId = null;
        } else if (!row.taskId && shape.type === "task") {
          const id = op.task?.id;
          if (!id) throw invalid("A block turned into a task needs a task id", index);
          const [prior] = await tx.select().from(tasks).where(eq(tasks.id, id));
          if (prior && prior.trashRootId === row.id && prior.deletedAt) {
            await restoreTask(id, row.id);
          } else if (prior) {
            throw new ApiException("CONFLICT", "A task with this id already exists");
          } else {
            await createTask(
              index,
              id,
              { type: row.containerType, id: row.containerId },
              titleOf(index, shape.content),
              op.task?.completed ?? false,
            );
          }
          taskId = id;
        }
        if (taskId && shape.type === "task") {
          await updateTask(
            index,
            taskId,
            op.content || op.type ? shape.content : undefined,
            op.task,
          );
        }

        const moved = op.container ? await containerPatch(index, row, op.container) : {};
        const updated = await update(row.id, {
          ...shape,
          ...moved,
          fileId,
          taskId,
          ...(op.position ? { position: op.position } : {}),
          ...(restored ? { deletedAt: null, deletedBy: null, trashRootId: null } : {}),
        });
        if (restored) await setSublistTrash(updated, false);
        return updated;
      }
    }
  }

  async function update(id: string, patch: Partial<typeof blocks.$inferInsert>) {
    const [updated] = await tx
      .update(blocks)
      .set({ ...patch, version: sql`${blocks.version} + 1` })
      .where(eq(blocks.id, id))
      .returning();
    if (!updated) throw new Error(`block ${id} vanished during update`);
    return updated;
  }

  for (const id of deleted) {
    const row = existing.get(id);
    if (!row) continue;
    await emit(page.blockChannels, {
      op: "delete",
      entity: "block",
      id,
      version: row.version,
    });
  }
  const dtos = await blockDtos(tx, [...changed.values()]);
  for (const dto of dtos) {
    await emit(page.blockChannels, {
      op: "upsert",
      entity: "block",
      id: dto.id,
      version: dto.version,
      data: dto,
    });
  }
  await emitTasks(tx, emit, touchedTasks);
  return { blocks: dtos, deleted: [...new Set(deleted)] };
}
