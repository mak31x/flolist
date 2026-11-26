import { blocks } from "@flolist/db";
import {
  blockBatchSchema,
  channel,
  idParamSchema,
  resolveBlockShape,
  type BlockBatchResult,
  type BlockContent,
  type BlockOp,
  type BlockPage,
  type BlockShape,
} from "@flolist/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize } from "../authz/authorize.ts";
import { blockDto, type BlockRow } from "../blocks/dto.ts";
import { ApiException, notFound } from "../lib/errors.ts";
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
                const [created] = await tx
                  .insert(blocks)
                  .values({
                    id: op.id,
                    containerType: "list",
                    containerId: listId,
                    rootListId: root.id,
                    position: op.position,
                    ...shape,
                    createdBy: user.id,
                  })
                  .onConflictDoNothing()
                  .returning();
                if (!created)
                  throw new ApiException("CONFLICT", "A block with this id already exists");
                return created;
              }
              const shape = resolveShape(index, shapeOf(row), op);
              return update(row.id, {
                ...shape,
                ...(op.position ? { position: op.position } : {}),
                ...(row.deletedAt ? { deletedAt: null, deletedBy: null, trashRootId: null } : {}),
              });
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
  );
