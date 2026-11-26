import type { blockMaxIndent, blocks, blockTypes } from "@flolist/db";
import { blockContentSchema, type Block, type BlockType, type MAX_INDENT } from "@flolist/shared";

export type BlockRow = typeof blocks.$inferSelect;

// The DB's CHECK constraints come from its own copies of these; a drift fails typecheck.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const blockConstantsMatch: [
  Same<(typeof blockTypes)[number], BlockType>,
  Same<typeof blockMaxIndent, typeof MAX_INDENT>,
] = [true, true];

export function blockDto(row: BlockRow): Block {
  return {
    id: row.id,
    containerType: row.containerType,
    containerId: row.containerId,
    rootListId: row.rootListId,
    position: row.position,
    type: row.type,
    indent: row.indent,
    // Written only after validation, so this parse is a cheap guard against hand-edited rows.
    content: blockContentSchema.parse(row.content),
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
