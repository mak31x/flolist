import { inlineText, type Block, type ListViewPrefs } from "@flolist/shared";

/** A top-level row and the nested rows (subtasks) that follow it. */
interface Group {
  head: Block;
  rows: Block[];
}

const isTask = (b: Block) => b.type === "task";
const isDone = (b: Block) => b.task?.completedAt != null;
const textOf = (b: Block) => ("inline" in b.content ? inlineText(b.content.inline).trim() : "");

/**
 * What the list shows under the caller's view settings (lists-and-blocks.md → Filter/sort
 * menu). `rows` is the visible tree (subtasks follow their task, `depth` says how deep); stored
 * positions never change, a sort only reorders what's rendered.
 * - Show tasks only hides everything that isn't a task (text, headings, media, sublists).
 * - Hide completed tasks hides completed tasks and the subtasks under them.
 * - Sorts reorder top-level rows; subtasks stay under their task `[assumption]`:
 *   Alphabetical by text (textless blocks last); Creator: the caller's blocks first, then
 *   others grouped by creator; Creation date: newest first; Completed: open tasks and other
 *   blocks in stored order, then completed tasks, most recently completed first; Priority:
 *   High → Low, then the rest; Due date: earliest first (on one day, timed before all-day),
 *   undated last; Label: by the first label's name, unlabeled last
 *   `[assumption: Superlist's exact orders unchecked]`.
 */
export function viewBlocks(
  rows: readonly Block[],
  prefs: ListViewPrefs,
  depth: ReadonlyMap<string, number> = new Map(),
  me: string | null = null,
  labelName: (id: string) => string | undefined = () => undefined,
): readonly Block[] {
  if (!prefs.tasksOnly && !prefs.hideCompleted && prefs.sort === "manual") return rows;

  // Filter, dropping the nested rows of anything hidden.
  const kept: Block[] = [];
  let hiddenAt: number | null = null;
  for (const row of rows) {
    const level = depth.get(row.id) ?? 0;
    if (hiddenAt !== null && level > hiddenAt) continue;
    hiddenAt = null;
    const hide = (prefs.tasksOnly && !isTask(row)) || (prefs.hideCompleted && isDone(row));
    if (hide) {
      hiddenAt = level;
      continue;
    }
    kept.push(row);
  }
  if (prefs.sort === "manual") return kept;

  const groups: Group[] = [];
  for (const row of kept) {
    const last = groups.at(-1);
    if ((depth.get(row.id) ?? 0) > 0 && last) last.rows.push(row);
    else groups.push({ head: row, rows: [row] });
  }
  const order = groups.map((g, i) => ({ g, i }));
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const byStored = (a: { i: number }, b: { i: number }) => a.i - b.i;

  switch (prefs.sort) {
    case "alphabetical":
      order.sort((a, b) => {
        const ka = textOf(a.g.head);
        const kb = textOf(b.g.head);
        if (ka === "" || kb === "") return ka === kb ? byStored(a, b) : ka === "" ? 1 : -1;
        return collator.compare(ka, kb) || byStored(a, b);
      });
      break;
    case "creator":
      order.sort((a, b) => {
        const ca = a.g.head.createdBy ?? "";
        const cb = b.g.head.createdBy ?? "";
        if (ca === cb) return byStored(a, b);
        if (ca === me) return -1;
        if (cb === me) return 1;
        return ca < cb ? -1 : 1;
      });
      break;
    case "created":
      order.sort((a, b) => b.g.head.createdAt.localeCompare(a.g.head.createdAt) || byStored(a, b));
      break;
    case "completed":
      order.sort((a, b) => {
        const da = a.g.head.task?.completedAt ?? null;
        const db = b.g.head.task?.completedAt ?? null;
        if (da === null || db === null) return da === db ? byStored(a, b) : da === null ? -1 : 1;
        return db.localeCompare(da) || byStored(a, b);
      });
      break;
    case "priority":
      order.sort(
        (a, b) => (b.g.head.task?.priority ?? 0) - (a.g.head.task?.priority ?? 0) || byStored(a, b),
      );
      break;
    case "due": {
      const key = (g: Group) => {
        const due = g.head.task?.due;
        return due ? `${due.date} ${due.time ?? "99:99"}` : null;
      };
      order.sort((a, b) => {
        const ka = key(a.g);
        const kb = key(b.g);
        if (ka === null || kb === null) return ka === kb ? byStored(a, b) : ka === null ? 1 : -1;
        return ka.localeCompare(kb) || byStored(a, b);
      });
      break;
    }
    case "label": {
      const key = (g: Group) => {
        const first = g.head.task?.labelIds.map(labelName).find((n) => n !== undefined);
        return first ?? null;
      };
      order.sort((a, b) => {
        const ka = key(a.g);
        const kb = key(b.g);
        if (ka === null || kb === null) return ka === kb ? byStored(a, b) : ka === null ? 1 : -1;
        return collator.compare(ka, kb) || byStored(a, b);
      });
      break;
    }
    default:
      break;
  }
  return order.flatMap(({ g }) => g.rows);
}

/** A view that differs from the stored order: drag reorder is off and a Reset chip shows. */
export const isSorted = (prefs: ListViewPrefs) => prefs.sort !== "manual";
export const isFiltered = (prefs: ListViewPrefs) => prefs.tasksOnly || prefs.hideCompleted;

/** Open tasks on a list page (its tasks and their subtasks), for sublist rows. */
export function openTaskCount(blocks: readonly Block[]): number {
  return blocks.filter((b) => isTask(b) && !isDone(b)).length;
}
