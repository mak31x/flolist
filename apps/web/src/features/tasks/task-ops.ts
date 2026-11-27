import {
  blocksToMarkdown,
  inlineText,
  positionsBetween,
  uuidv7,
  type Block,
  type BlockDraft,
} from "@flolist/shared";
import type { BlockFields, LocalOp } from "../editor/store.ts";
import { childrenOf, containerOf, subtasksOf } from "../editor/tree.ts";

/**
 * Pure helpers behind the task actions (tasks.md → Task actions): they turn a set of selected
 * blocks into store ops or clipboard text. `all` is every cached block of the list page.
 */

/** Whether `block` sits (at any depth) inside the body of a task in `taskIds`. */
function insideAny(all: readonly Block[], block: Block, taskIds: ReadonlySet<string>): boolean {
  let current: Block | undefined = block;
  while (current?.containerType === "task") {
    if (taskIds.has(current.containerId)) return true;
    const parentTask: string = current.containerId;
    current = all.find((b) => b.taskId === parentTask);
  }
  return false;
}

/**
 * The selected blocks that aren't carried by another selected task (a subtask whose parent
 * task is selected too travels inside it), in the order given.
 */
export function topLevel(all: readonly Block[], selected: readonly Block[]): Block[] {
  const tasks = new Set(selected.flatMap((b) => (b.taskId ? [b.taskId] : [])));
  return selected.filter((b) => !insideAny(all, b, tasks));
}

/** A copy of one block (and, for a task, its body) into `container` at `position`. */
function copyOps(
  all: readonly Block[],
  block: Block,
  fields: Pick<BlockFields, "position" | "container">,
  out: LocalOp[],
): string {
  const id = uuidv7();
  const taskId = block.taskId ? uuidv7() : undefined;
  out.push({
    op: "upsert",
    id,
    fields: {
      type: block.type,
      indent: block.indent,
      content: block.content,
      ...fields,
      ...(block.fileId ? { fileId: block.fileId } : {}),
      // tasks.md → Duplicate: incomplete, no assignee, no due date. Priority and labels stay
      // [assumption].
      ...(taskId && block.task
        ? {
            taskId,
            priority: block.task.priority,
            ...(block.task.labelIds.length > 0 ? { labelIds: block.task.labelIds } : {}),
          }
        : {}),
    },
  });
  if (block.taskId && taskId) {
    for (const child of childrenOf(all, { type: "task", id: block.taskId })) {
      copyOps(
        all,
        child,
        { position: child.position, container: { type: "task", id: taskId } },
        out,
      );
    }
  }
  return id;
}

/**
 * Duplicate (tasks.md → Duplicate): an exact copy of each block right below the original,
 * tasks with their bodies and subtasks. Sublists are skipped (Duplicate list copies them).
 * Returns the ops and the ids of the top-level copies, in order.
 */
export function duplicateOps(
  all: readonly Block[],
  selected: readonly Block[],
): { ops: LocalOp[]; ids: string[] } {
  const ops: LocalOp[] = [];
  const ids: string[] = [];
  for (const block of topLevel(all, selected)) {
    if (block.type === "sublist") continue;
    const siblings = childrenOf(all, containerOf(block));
    const index = siblings.findIndex((b) => b.id === block.id);
    const [position] = positionsBetween(block.position, siblings[index + 1]?.position ?? null, 1);
    if (!position) continue;
    ids.push(
      copyOps(
        all,
        block,
        block.containerType === "task" ? { position, container: containerOf(block) } : { position },
        ops,
      ),
    );
  }
  return { ops, ids };
}

/**
 * Mark complete / incomplete for the selected tasks. With `completed` unset it toggles like
 * Mod+D: everything is completed unless all of them already are.
 */
export function completeOps(
  selected: readonly Block[],
  completed?: boolean,
): { ops: LocalOp[]; completed: boolean } {
  const tasks = selected.filter((b) => b.type === "task");
  const target = completed ?? !tasks.every((b) => b.task?.completedAt != null);
  return {
    completed: target,
    ops: tasks
      .filter((b) => (b.task?.completedAt != null) !== target)
      .map((b) => ({ op: "upsert", id: b.id, fields: { completed: target } })),
  };
}

/** The same fields on every selected task. */
export function taskFieldOps(selected: readonly Block[], fields: BlockFields): LocalOp[] {
  return selected.filter((b) => b.type === "task").map((b) => ({ op: "upsert", id: b.id, fields }));
}

/** Each selected block with its subtasks below it (one level deeper per nesting). */
function withSubtasks(all: readonly Block[], selected: readonly Block[]) {
  const out: { block: Block; depth: number }[] = [];
  const walk = (block: Block, depth: number) => {
    out.push({ block, depth });
    if (block.taskId) for (const sub of subtasksOf(all, block.taskId)) walk(sub, depth + 1);
  };
  for (const block of topLevel(all, selected)) walk(block, 0);
  return out;
}

const textOf = (b: Block) => ("inline" in b.content ? inlineText(b.content.inline) : "");

/**
 * Copy as Markdown: tasks are `- [ ]` / `- [x]` items with their subtasks nested under them
 * (tasks.md → Printing / export); other blocks as the clipboard writes them.
 */
export function toMarkdown(all: readonly Block[], selected: readonly Block[]): string {
  const drafts: BlockDraft[] = withSubtasks(all, selected).map(({ block, depth }) => ({
    type: block.type,
    indent: block.type === "task" ? depth : block.indent,
    content: block.content,
    ...(block.fileId ? { fileId: block.fileId } : {}),
    ...(block.task ? { completed: block.task.completedAt !== null } : {}),
  }));
  return blocksToMarkdown(drafts);
}

/** Copy as text: plain titles, one per line, subtasks indented by two spaces [assumption]. */
export function toPlainText(all: readonly Block[], selected: readonly Block[]): string {
  return withSubtasks(all, selected)
    .map(({ block, depth }) => "  ".repeat(depth) + textOf(block))
    .join("\n");
}

/** Copy link: one URL per selected task (its details page), one per line. */
export function toLinks(origin: string, listId: string, selected: readonly Block[]): string {
  return selected
    .flatMap((b) => (b.taskId ? [`${origin}/lists/${listId}/tasks/${b.taskId}`] : []))
    .join("\n");
}
