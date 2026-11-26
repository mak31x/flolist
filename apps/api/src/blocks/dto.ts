import {
  tasks,
  type blockMaxIndent,
  type blocks,
  type blockTypes,
  type Executor,
} from "@flolist/db";
import {
  blockContentSchema,
  type Block,
  type BlockTask,
  type BlockType,
  type MAX_INDENT,
} from "@flolist/shared";
import { inArray } from "drizzle-orm";

export type BlockRow = typeof blocks.$inferSelect;

// The DB's CHECK constraints come from its own copies of these; a drift fails typecheck.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const blockConstantsMatch: [
  Same<(typeof blockTypes)[number], BlockType>,
  Same<typeof blockMaxIndent, typeof MAX_INDENT>,
] = [true, true];

/** `task` is the state of a task block's task (null for other blocks). */
export function blockDto(row: BlockRow, task: BlockTask | null = null): Block {
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
    fileId: row.fileId,
    sublistId: row.sublistId,
    taskId: row.taskId,
    task: row.taskId ? (task ?? { completedAt: null, completedBy: null }) : null,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Task state for the task blocks among `rows`, read in one query. */
export async function taskStates(db: Executor, rows: readonly BlockRow[]) {
  const ids = rows.map((r) => r.taskId).filter((id) => id !== null);
  const states = new Map<string, BlockTask>();
  if (ids.length === 0) return states;
  const found = await db
    .select({ id: tasks.id, completedAt: tasks.completedAt, completedBy: tasks.completedBy })
    .from(tasks)
    .where(inArray(tasks.id, ids));
  for (const t of found) {
    states.set(t.id, {
      completedAt: t.completedAt?.toISOString() ?? null,
      completedBy: t.completedBy,
    });
  }
  return states;
}

/** DTOs for any rows, task blocks included. */
export async function blockDtos(db: Executor, rows: readonly BlockRow[]): Promise<Block[]> {
  const states = await taskStates(db, rows);
  return rows.map((r) => blockDto(r, r.taskId ? (states.get(r.taskId) ?? null) : null));
}
