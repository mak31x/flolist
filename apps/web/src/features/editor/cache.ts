import { byPosition, type Block } from "@flolist/shared";

/** Pure helpers for a list's block array (always sorted by position, ties by id). */

export const sortBlocks = (blocks: readonly Block[]) => [...blocks].sort(byPosition);

/** Inserts or replaces a block, keeping the order. */
export function upsertBlock(blocks: readonly Block[], block: Block): Block[] {
  const index = blocks.findIndex((b) => b.id === block.id);
  if (index === -1 || blocks[index]?.position !== block.position) {
    return sortBlocks([...blocks.filter((b) => b.id !== block.id), block]);
  }
  const next = [...blocks];
  next[index] = block;
  return next;
}

export const removeBlock = (blocks: readonly Block[], id: string) =>
  blocks.filter((b) => b.id !== id);
