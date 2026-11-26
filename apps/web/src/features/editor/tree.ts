import { positionBetween, type Block, type BlockContainer } from "@flolist/shared";
import type { BlockFields } from "./store.ts";

/**
 * A list page's cache holds the list's blocks and the bodies of its tasks (D-056). These pure
 * helpers turn it into what an editor shows: the blocks of one root container in order, each
 * task followed by its subtasks (nested, unless collapsed).
 */

export const sameContainer = (a: BlockContainer, b: Block) =>
  b.containerType === a.type && b.containerId === a.id;

export const containerOf = (b: Block): BlockContainer => ({
  type: b.containerType,
  id: b.containerId,
});

/** The blocks of one container, in stored order (the cache is sorted by position). */
export function childrenOf(blocks: readonly Block[], container: BlockContainer): Block[] {
  return blocks.filter((b) => sameContainer(container, b));
}

/** A task block's subtasks (the task blocks of its body). */
export function subtasksOf(blocks: readonly Block[], taskId: string): Block[] {
  return childrenOf(blocks, { type: "task", id: taskId }).filter((b) => b.type === "task");
}

export interface VisibleTree {
  rows: Block[];
  /** Nesting level per row: 0 for the root container's blocks. */
  depth: Map<string, number>;
}

/**
 * The rows an editor shows for `root`: its blocks, and under every task its subtasks (only the
 * task blocks of a body; text and media in a body show in the details panel) `[assumption]`.
 * Tasks in `collapsed` (by block id) hide their subtasks.
 */
export function visibleTree(
  blocks: readonly Block[],
  root: BlockContainer,
  collapsed: ReadonlySet<string> = new Set(),
): VisibleTree {
  const byContainer = new Map<string, Block[]>();
  for (const b of blocks) {
    const key = `${b.containerType}:${b.containerId}`;
    const list = byContainer.get(key);
    if (list) list.push(b);
    else byContainer.set(key, [b]);
  }
  const rows: Block[] = [];
  const depth = new Map<string, number>();
  const walk = (container: BlockContainer, level: number) => {
    for (const b of byContainer.get(`${container.type}:${container.id}`) ?? []) {
      if (level > 0 && b.type !== "task") continue;
      rows.push(b);
      depth.set(b.id, level);
      if (b.taskId && !collapsed.has(b.id) && level < 16) {
        walk({ type: "task", id: b.taskId }, level + 1);
      }
    }
  };
  walk(root, 0);
  return { rows, depth };
}

/** Direct subtasks done and in all, for the progress ring. */
export function subtaskProgress(
  blocks: readonly Block[],
  taskId: string,
): { done: number; total: number } {
  const subtasks = subtasksOf(blocks, taskId);
  return {
    done: subtasks.filter((b) => b.task?.completedAt).length,
    total: subtasks.length,
  };
}

/** Where a new block goes right after (or before) `block`, in the same container. */
export function placeNear(
  blocks: readonly Block[],
  block: Block,
  side: "after" | "before",
): Pick<BlockFields, "position" | "container"> {
  const siblings = childrenOf(blocks, containerOf(block));
  const index = siblings.findIndex((b) => b.id === block.id);
  const position =
    side === "after"
      ? positionBetween(block.position, siblings[index + 1]?.position ?? null)
      : positionBetween(siblings[index - 1]?.position ?? null, block.position);
  return block.containerType === "list"
    ? { position }
    : { position, container: containerOf(block) };
}

/** The last position in a container (after its last block). */
export function positionAtEnd(blocks: readonly Block[], container: BlockContainer): string {
  return positionBetween(childrenOf(blocks, container).at(-1)?.position ?? null, null);
}

/** The task block that holds a body (the parent of a subtask), if it's in the cache. */
export function parentBlockOf(blocks: readonly Block[], block: Block): Block | undefined {
  if (block.containerType !== "task") return undefined;
  return blocks.find((b) => b.taskId === block.containerId);
}

/** `block`, or the ancestor of it that sits in `root` (media and sublists go there). */
export function ancestorIn(
  blocks: readonly Block[],
  root: BlockContainer,
  block: Block,
): Block | undefined {
  let cur: Block | undefined = block;
  for (let i = 0; cur && !sameContainer(root, cur) && i < 32; i++) cur = parentBlockOf(blocks, cur);
  return cur;
}

/** The ids of `ids` and of every block in their task bodies, at any depth. */
export function withDescendants(blocks: readonly Block[], ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  const tasks = new Set(
    blocks.filter((b) => out.has(b.id) && b.taskId).map((b) => b.taskId as string),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of blocks) {
      if (out.has(b.id) || b.containerType !== "task" || !tasks.has(b.containerId)) continue;
      out.add(b.id);
      if (b.taskId) tasks.add(b.taskId);
      grew = true;
    }
  }
  return out;
}
