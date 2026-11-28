import {
  compareKeys,
  type Block,
  type InboxPage,
  type ListViewPrefs,
  type Task,
  type TodayPage,
} from "@flolist/shared";
import { viewBlocks } from "../lists/list-view.ts";

/**
 * Pure helpers that turn the Inbox and Today pages into rows. Rows are tasks shaped as task
 * blocks (`taskAsBlock`), so the views reuse the list's row parts, meta line, pickers and sorts
 * (`viewBlocks`). A row's id is its task id.
 */

/** A task as a task block, for the row parts and sorts shared with the list editor. */
export function taskAsBlock(task: Task): Block {
  return {
    id: task.id,
    containerType: task.listId ? "list" : "task",
    containerId: task.listId ?? task.id,
    rootListId: task.rootListId,
    position: "a0",
    type: "task",
    indent: 0,
    content: { inline: task.titleInline },
    fileId: null,
    sublistId: null,
    taskId: task.id,
    task: {
      completedAt: task.completedAt,
      completedBy: task.completedBy,
      due: task.due,
      priority: task.priority,
      labelIds: task.labelIds,
    },
    createdBy: task.createdBy,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export interface ViewRow {
  task: Task;
  block: Block;
  /** 0 for a top-level row, 1 for its subtasks, … */
  depth: number;
  /** Open/total subtasks right below it. */
  progress: { done: number; total: number };
}

/** Each task's children in page order (their block positions, then creation). */
function childrenBy(
  tasks: readonly Task[],
  positions: Readonly<Record<string, string>>,
): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    out.set(task.parentTaskId, [...(out.get(task.parentTaskId) ?? []), task]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => {
      const pa = positions[a.id];
      const pb = positions[b.id];
      if (pa && pb && pa !== pb) return compareKeys(pa, pb);
      if (pa !== pb) return pa ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
  }
  return out;
}

const progressOf = (children: readonly Task[] | undefined) => ({
  done: children?.filter((c) => c.completedAt !== null).length ?? 0,
  total: children?.length ?? 0,
});

/** Builds rows for `heads` with their subtasks below them (unless collapsed). */
function withSubtasks(
  heads: readonly Task[],
  children: Map<string, Task[]>,
  collapsed: ReadonlySet<string>,
): ViewRow[] {
  const rows: ViewRow[] = [];
  const visit = (task: Task, depth: number) => {
    const kids = children.get(task.id);
    rows.push({ task, block: taskAsBlock(task), depth, progress: progressOf(kids) });
    if (collapsed.has(task.id)) return;
    for (const child of kids ?? []) visit(child, depth + 1);
  };
  for (const head of heads) visit(head, 0);
  return rows;
}

/** Applies the view's sort and Hide completed to rows (subtasks stay under their task). */
export function sortRows(
  rows: readonly ViewRow[],
  prefs: ListViewPrefs,
  me: string | null,
  labelName: (id: string) => string | undefined,
): ViewRow[] {
  const byId = new Map(rows.map((r) => [r.block.id, r]));
  const depth = new Map(rows.map((r) => [r.block.id, r.depth]));
  return viewBlocks(
    rows.map((r) => r.block),
    prefs,
    depth,
    me,
    labelName,
  ).flatMap((b) => byId.get(b.id) ?? []);
}

/**
 * The Inbox's rows: its items in manual order with their subtasks nested under them
 * (views.md → Inbox). Completed tasks stay in the Inbox; `prefs.hideCompleted` hides them.
 */
export function inboxRows(page: InboxPage, collapsed: ReadonlySet<string> = new Set()): ViewRow[] {
  const byId = new Map(page.tasks.map((x) => [x.id, x]));
  const items = [...page.items].sort(
    (a, b) => compareKeys(a.position, b.position) || a.taskId.localeCompare(b.taskId),
  );
  const heads = items.flatMap((i) => byId.get(i.taskId) ?? []);
  return withSubtasks(heads, childrenBy(page.tasks, page.positions), collapsed);
}

export interface TodayGroups {
  overdue: Task[];
  today: Task[];
  completed: Task[];
}

/**
 * Today's groups for `date` (views.md → Today). The client re-derives membership from the
 * cached tasks so optimistic changes (completing, rescheduling) move rows at once: open tasks
 * due before the day are Overdue, due on it are Today; completed are the server's list plus
 * anything completed here meanwhile. Manual order (`order`) goes first, the rest follow.
 */
export function todayGroups(page: TodayPage, today: string): TodayGroups {
  const open = page.open.filter((x) => x.completedAt === null && x.due && x.due.date <= page.date);
  // The server's open tasks were open when fetched: any completed since were completed now,
  // which counts for the Completed tab of today only.
  const completedHere = page.date === today ? page.open.filter((x) => x.completedAt !== null) : [];
  const completed = [
    ...page.completed.filter((x) => x.completedAt !== null),
    ...completedHere.filter((x) => !page.completed.some((c) => c.id === x.id)),
  ];
  const manual = (a: Task, b: Task) => {
    const pa = page.order[a.id];
    const pb = page.order[b.id];
    if (pa && pb && pa !== pb) return compareKeys(pa, pb);
    if (pa !== pb) return pa ? -1 : 1;
    return 0;
  };
  return {
    overdue: open.filter((x) => (x.due?.date ?? "") < page.date).sort(manual),
    today: open.filter((x) => x.due?.date === page.date).sort(manual),
    completed,
  };
}

/** Flat rows (Today shows each due task on its own, subtasks included `[assumption]`). */
export function flatRows(tasks: readonly Task[]): ViewRow[] {
  return tasks.map((task) => ({
    task,
    block: taskAsBlock(task),
    depth: 0,
    progress: { done: 0, total: 0 },
  }));
}
