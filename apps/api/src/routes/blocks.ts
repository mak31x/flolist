import { blocks, files, lists } from "@flolist/db";
import {
  blockBatchSchema,
  channel,
  moveBlocksToSchema,
  positionAfter,
  positionsBetween,
  idParamSchema,
  isInlineImage,
  isMediaBlockType,
  resolveBlockShape,
  type BlockFileMeta,
  type MediaContent,
  type BlockBatchResult,
  type BlockContent,
  type BlockOp,
  type BlockPage,
  type BlockShape,
} from "@flolist/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize } from "../authz/authorize.ts";
import { blockDto, type BlockRow } from "../blocks/dto.ts";
import { ApiException, notFound } from "../lib/errors.ts";
import { listChannels, listDto } from "../lists/dto.ts";
import { subtreeIds } from "../lists/tree.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { dbOf, type AppEnv } from "../types.ts";

const invalid = (message: string, index: number) =>
  new ApiException("VALIDATION", message, {
    details: [{ source: "json", path: ["ops", index], message }],
  });

function resolveShape(
  index: number,
  current: BlockShape | null,
  fields: Parameters<typeof resolveBlockShape>[1],
): BlockShape {
  const result = resolveBlockShape(current, fields);
  if (!result.ok) throw invalid(result.error, index);
  return result.shape;
}

/** A row's content was validated on write (`blockDto` re-checks it on the way out). */
const shapeOf = (row: BlockRow) => ({
  type: row.type,
  indent: row.indent,
  content: row.content as BlockContent,
});

export const blockRoutes = new Hono<AppEnv>()
  /** The list's live blocks in order (D-007). Sublists (M2.3) are their own containers. */
  .get("/:id/blocks", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = dbOf(c);
    await authorize(db, c.get("user"), "list.view", { type: "list", id });
    const rows = await db
      .select()
      .from(blocks)
      .where(
        and(eq(blocks.containerType, "list"), eq(blocks.containerId, id), isNull(blocks.deletedAt)),
      )
      .orderBy(asc(blocks.position), asc(blocks.id));
    const body: BlockPage = { items: rows.map(blockDto) };
    return c.json(body);
  })

  /**
   * Applies one editor command atomically: upserts (create, or change only the sent fields;
   * field-level LWW, D-006), moves and soft deletes. An upsert of a soft-deleted block of this
   * list restores it, which is how undo brings a deleted block back. Deleting a block that is
   * already gone is a no-op, so two clients deleting the same block don't conflict.
   *
   * Image/attachment blocks name a ready file of the list's workspace (`fileId`); the server
   * fills `content.file` from it. A new sublist block creates its child list in the same
   * transaction; deleting the block sends the child lists to Trash with it (trash root = the
   * block), and restoring the block brings them back.
   */
  .post(
    "/:id/blocks/batch",
    validate("param", idParamSchema),
    validate("json", blockBatchSchema),
    async (c) => {
      const { id: listId } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const { root } = await authorize(tx, user, "list.edit", { type: "list", id: listId });

        const ids = input.ops.map((op) => op.id);
        const existing = new Map<string, BlockRow>();
        for (const row of await tx
          .select()
          .from(blocks)
          .where(inArray(blocks.id, ids))
          .for("update")) {
          existing.set(row.id, row);
        }
        const inThisList = (row: BlockRow | undefined): row is BlockRow =>
          row !== undefined && row.containerType === "list" && row.containerId === listId;

        const changed: BlockRow[] = [];
        const deleted: string[] = [];
        const now = new Date();
        const listChannelsOfRoot = listChannels(root);

        async function fileMeta(index: number, fileId: string, image: boolean) {
          const [file] = await tx.select().from(files).where(eq(files.id, fileId));
          if (file?.status !== "ready" || file.workspaceId !== root.workspaceId) {
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
              listChannelsOfRoot,
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

        for (const [index, op] of input.ops.entries()) {
          const row = existing.get(op.id);
          if (row && !inThisList(row)) {
            // Ids are client-made UUIDv7s; a clash with another container is never legitimate.
            throw op.op === "upsert"
              ? new ApiException("CONFLICT", "A block with this id already exists")
              : notFound("Block");
          }
          const result = await applyOp(index, op, row);
          if (result === "deleted") deleted.push(op.id);
          else if (result) changed.push(result);
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
              await setSublistTrash(gone, true);
              await emit([channel.list(root.id)], {
                op: "delete",
                entity: "block",
                id: gone.id,
                version: gone.version,
              });
              return "deleted";
            }
            case "move": {
              if (!row || row.deletedAt) throw notFound("Block");
              const shape = resolveShape(index, shapeOf(row), { indent: op.indent });
              return update(row.id, { position: op.position, indent: shape.indent });
            }
            case "upsert": {
              if (!row) {
                if (!op.position) throw invalid("A new block needs a type and a position", index);
                const shape = resolveShape(index, null, op);
                const media = isMediaBlockType(shape.type);
                if (media !== (op.fileId !== undefined)) {
                  throw invalid(
                    media ? "A new media block needs a file" : "Only media blocks take a file",
                    index,
                  );
                }
                if ((shape.type === "sublist") !== (op.sublist !== undefined)) {
                  throw invalid(
                    op.sublist
                      ? "Only sublist blocks take a sublist"
                      : "A sublist block needs a list",
                    index,
                  );
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
                      workspaceId: root.workspaceId,
                      rootListId: root.id,
                      parentListId: listId,
                      title: op.sublist.title.trim(),
                      createdBy: user.id,
                    })
                    .onConflictDoNothing()
                    .returning();
                  if (!sublist) {
                    throw new ApiException("CONFLICT", "A list with this id already exists");
                  }
                }
                const [created] = await tx
                  .insert(blocks)
                  .values({
                    id: op.id,
                    containerType: "list",
                    containerId: listId,
                    rootListId: root.id,
                    position: op.position,
                    ...shape,
                    fileId: op.fileId ?? null,
                    sublistId: sublist?.id ?? null,
                    createdBy: user.id,
                  })
                  .onConflictDoNothing()
                  .returning();
                if (!created)
                  throw new ApiException("CONFLICT", "A block with this id already exists");
                if (sublist) {
                  const [linked] = await tx
                    .update(lists)
                    .set({ parentBlockId: created.id })
                    .where(eq(lists.id, sublist.id))
                    .returning();
                  if (!linked) throw new Error("sublist vanished");
                  await emit(listChannelsOfRoot, {
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
              const updated = await update(row.id, {
                ...shape,
                fileId,
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

        for (const row of changed) {
          await emit([channel.list(root.id)], {
            op: "upsert",
            entity: "block",
            id: row.id,
            version: row.version,
            data: blockDto(row),
          });
        }
        const body: BlockBatchResult = { blocks: changed.map(blockDto), deleted };
        return { status: 200, body };
      });
    },
  )
  /**
   * Moves blocks into another list (a drop on a sublist row or a sidebar list; D-047). They
   * keep their order and go to the end of the target. A sublist block takes its child lists
   * along. Both lists must be editable and in the same workspace, and a sublist can't be
   * dropped into itself or its own sublists. Not undoable [assumption].
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
        const rows = await tx
          .select()
          .from(blocks)
          .where(
            and(
              inArray(blocks.id, input.ids),
              eq(blocks.containerType, "list"),
              eq(blocks.containerId, listId),
              isNull(blocks.deletedAt),
            ),
          )
          .orderBy(asc(blocks.position), asc(blocks.id))
          .for("update");
        if (rows.length !== input.ids.length) throw notFound("Block");

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
        for (const row of moved) {
          await emit([channel.list(source.root.id)], {
            op: "delete",
            entity: "block",
            id: row.id,
            version: row.version,
          });
        }
        for (const row of moved) {
          await emit([channel.list(target.root.id)], {
            op: "upsert",
            entity: "block",
            id: row.id,
            version: row.version,
            data: blockDto(row),
          });
        }
        const body: BlockBatchResult = { blocks: moved.map(blockDto), deleted: [] };
        return { status: 200, body };
      });
    },
  );
