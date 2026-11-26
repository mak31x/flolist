import { inlineText, type Block, type ListViewPrefs } from "@flolist/shared";

/**
 * What the list shows under the caller's view settings (lists-and-blocks.md → Filter/sort
 * menu). Stored positions never change; a sort only reorders what's rendered.
 * - Show tasks only hides everything that isn't a task (text, headings, media, sublists).
 * - Hide completed tasks applies once tasks exist (M3.1).
 * - Alphabetical orders blocks by their text (until tasks exist, this sorts checklist-style
 *   lists of bullets and paragraphs) [assumption]; blocks without text keep the end.
 */
export function viewBlocks(blocks: readonly Block[], prefs: ListViewPrefs): readonly Block[] {
  let rows = prefs.tasksOnly ? blocks.filter((b) => (b.type as string) === "task") : blocks;
  if (prefs.sort === "alphabetical") {
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const key = (b: Block) => ("inline" in b.content ? inlineText(b.content.inline).trim() : "");
    rows = [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === "" || kb === "") return ka === kb ? 0 : ka === "" ? 1 : -1;
      return collator.compare(ka, kb);
    });
  }
  return rows;
}

/** A view that differs from the stored order: drag reorder is off and a Reset chip shows. */
export const isSorted = (prefs: ListViewPrefs) => prefs.sort !== "manual";
export const isFiltered = (prefs: ListViewPrefs) => prefs.tasksOnly || prefs.hideCompleted;
