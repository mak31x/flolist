import type { Block } from "@flolist/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isModKey } from "../editor/keys.ts";
import type { SelectMode } from "../editor/select-gestures.ts";
import type { ViewRow } from "./rows.ts";
import type { ViewActions } from "./view-actions.tsx";
import { ViewSelectionBar } from "./ViewActionUi.tsx";

/**
 * Multiselect in the Inbox and Today (views.md → Multiselect): the list's gestures (Mod-click
 * toggles, Shift-click selects a range, long-press on touch) over view rows, the floating bar,
 * and the selection keys (Esc, Mod+D, Mod+Backspace, Mod+Shift+I, Mod+Shift+R).
 */
export function useViewSelection(rows: readonly ViewRow[], actions: ViewActions) {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  // Rows that left the view leave the selection.
  const live = useMemo(() => ids.filter((id) => rows.some((r) => r.task.id === id)), [ids, rows]);
  const selected = useMemo(
    () => rows.filter((r) => live.includes(r.task.id)).map((r) => r.task),
    [rows, live],
  );
  const clear = useCallback(() => {
    setIds([]);
    setAnchor(null);
  }, []);

  const onSelect = useCallback(
    (block: Block, mode: SelectMode) => {
      const id = block.id;
      if (mode === "toggle") {
        setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
        setAnchor(id);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      const editing = document.activeElement
        ?.closest<HTMLElement>("[data-task-row]")
        ?.getAttribute("data-task-row");
      const from = anchor ?? editing ?? id;
      const a = rows.findIndex((r) => r.task.id === from);
      const b = rows.findIndex((r) => r.task.id === id);
      if (a === -1 || b === -1) return;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setIds(rows.slice(lo, hi + 1).map((r) => r.task.id));
      setAnchor(from);
      (document.activeElement as HTMLElement | null)?.blur();
    },
    [rows, anchor],
  );

  useEffect(() => {
    if (selected.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      // Keys typed into a title or a popover aren't selection keys.
      const target = event.target as HTMLElement | null;
      if (target?.closest("[contenteditable='true'], input, textarea")) return;
      let handled = true;
      if (event.key === "Escape") clear();
      else if (isModKey(event, "d")) actions.run("complete", selected);
      else if (isModKey(event, "backspace") || isModKey(event, "delete")) {
        actions.run("delete", selected);
        clear();
      } else if (isModKey(event, "i", true)) actions.run("addToInbox", selected);
      else if (isModKey(event, "r", true) && selected.every((x) => x.listId)) {
        actions.run("removeFromList", selected);
        clear();
      } else handled = false;
      if (handled) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [selected, actions, clear]);

  return {
    selected,
    isSelected: (id: string) => live.includes(id),
    onSelect,
    clear,
    bar:
      selected.length > 0 ? (
        <ViewSelectionBar tasks={selected} actions={actions} onClear={clear} />
      ) : null,
  };
}
