import type { Block } from "@flolist/shared";
import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { t } from "../../i18n/index.ts";
import { editorFor } from "./focus.ts";
import { turnInto, type KeyContext } from "./keyboard.ts";
import { filterSlashItems } from "./slash.ts";

export interface SlashState {
  blockId: string;
  query: string;
  active: number;
  anchor: { left: number; top: number; height: number };
}

export type SlashApi = KeyContext["slash"] & {
  /** Re-reads the query after the block's text changed (or closes the menu). */
  update: (blockId: string) => void;
  /** Focus moved to `blockId`; a menu open on another block closes. */
  focused: (blockId: string) => void;
  pick: (type: Parameters<typeof turnInto>[2]) => void;
  hover: (index: number) => void;
  close: () => void;
};

const MAX_QUERY = 30;

/**
 * State of the slash menu. "/" at the start of a block opens it; the text typed after the "/"
 * filters it; picking an item removes "/query" and turns the block into that type.
 */
export function useSlash(getCtx: () => KeyContext): [SlashState | null, SlashApi] {
  const [state, setState] = useState<SlashState | null>(null);
  const [api] = useState<SlashApi>(() => {
    let current: SlashState | null = null;
    const set = (next: SlashState | null) => {
      current = next;
      setState(next);
    };
    const items = (s: SlashState) => filterSlashItems(s.query, t);
    const pick: SlashApi["pick"] = (type) => {
      const s = current;
      set(null);
      if (!s) return;
      const editor = editorFor(s.blockId);
      const block = getCtx()
        .rows()
        .find((b) => b.id === s.blockId);
      if (!editor || !block) return;
      turnInto(getCtx(), block, type, editor, { from: 1, to: editor.state.selection.from });
    };
    return {
      open: (block: Block, editor: Editor) => {
        let anchor = { left: 0, top: 0, height: 0 };
        try {
          const c = editor.view.coordsAtPos(1);
          anchor = { left: c.left, top: c.top, height: c.bottom - c.top };
        } catch {
          // jsdom: no layout.
        }
        set({ blockId: block.id, query: "", active: 0, anchor });
      },
      onKey: (block, event) => {
        const s = current;
        if (!s || s.blockId !== block.id) return false;
        const list = items(s);
        switch (event.key) {
          case "ArrowDown":
          case "ArrowUp": {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            const n = Math.max(1, list.length);
            set({ ...s, active: (s.active + step + n) % n });
            return true;
          }
          case "Enter":
          case "Tab": {
            const item = list[Math.min(s.active, list.length - 1)];
            if (!item) {
              set(null);
              return false;
            }
            event.preventDefault();
            pick(item.type);
            return true;
          }
          case "Escape":
            // Esc closes the menu and leaves the "/" where it is.
            event.preventDefault();
            set(null);
            return true;
          default:
            return false;
        }
      },
      update: (blockId) => {
        const s = current;
        if (!s || s.blockId !== blockId) return;
        const editor = editorFor(blockId);
        if (!editor) {
          set(null);
          return;
        }
        const { doc, selection } = editor.state;
        const typed = doc.textBetween(1, selection.from, "\n");
        if (!selection.empty || !typed.startsWith("/")) {
          set(null);
          return;
        }
        const query = typed.slice(1);
        const none = filterSlashItems(query, t).length === 0;
        if (query.length > MAX_QUERY || (none && /\s$/.test(query))) {
          set(null);
          return;
        }
        if (query !== s.query) set({ ...s, query, active: 0 });
      },
      focused: (blockId) => {
        if (current && current.blockId !== blockId) set(null);
      },
      pick,
      hover: (index) => {
        if (current) set({ ...current, active: index });
      },
      close: () => {
        set(null);
      },
    };
  });

  // Screen readers: the focused block controls the listbox and points at the highlighted item.
  useEffect(() => {
    if (!state) return;
    const dom = editorFor(state.blockId)?.view.dom;
    if (!dom) return;
    const listId = `slash-${state.blockId}`;
    const item = filterSlashItems(state.query, t)[state.active];
    dom.setAttribute("aria-controls", listId);
    dom.setAttribute("aria-expanded", "true");
    if (item) dom.setAttribute("aria-activedescendant", `${listId}-${item.type}`);
    else dom.removeAttribute("aria-activedescendant");
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-expanded");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [state]);

  return [state, api];
}
