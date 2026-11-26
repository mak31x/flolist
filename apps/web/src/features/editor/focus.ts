import type { Editor } from "@tiptap/core";

/**
 * Where the caret goes when focus moves into a block: an end, a text offset, or a horizontal
 * pixel position on the first/last line (↑/↓ keep the caret column, lists-and-blocks.md).
 */
export type CaretTarget =
  "start" | "end" | { offset: number } | { x: number; line: "first" | "last" };

/**
 * The mounted inline editors of the blocks on screen, by block id. Commands that create a block
 * and move focus into it run before its editor mounts, so a request waits here until it does.
 */
const editors = new Map<string, Editor>();
const pending = new Map<string, CaretTarget>();

export function registerEditor(blockId: string, editor: Editor): () => void {
  editors.set(blockId, editor);
  if (pending.has(blockId)) {
    // After the commit: StrictMode (dev) replays mount effects, and EditorContent's replay
    // detaches the editor's DOM for a moment, which would drop focus placed now. A microtask
    // still runs before the next key event.
    queueMicrotask(() => {
      const target = pending.get(blockId);
      const current = editors.get(blockId);
      if (target === undefined || !current || current.isDestroyed) return;
      pending.delete(blockId);
      placeCaret(current, target);
    });
  }
  return () => {
    if (editors.get(blockId) === editor) editors.delete(blockId);
  };
}

export const editorFor = (blockId: string) => editors.get(blockId);

/** Focuses a block's text now, or as soon as its editor mounts. */
export function focusBlock(blockId: string, target: CaretTarget = "end"): void {
  const editor = editors.get(blockId);
  if (editor && !editor.isDestroyed) placeCaret(editor, target);
  else pending.set(blockId, target);
}

/** Text positions of a one-paragraph document: 1 = before the first character. */
const textStart = 1;
const textEnd = (editor: Editor) => editor.state.doc.content.size - 1;

function placeCaret(editor: Editor, target: CaretTarget): void {
  let pos: number;
  if (target === "start") pos = textStart;
  else if (target === "end") pos = textEnd(editor);
  else if ("offset" in target)
    pos = Math.min(textStart + Math.max(0, target.offset), textEnd(editor));
  else pos = posAtColumn(editor, target.x, target.line);
  // Focus now, not on the next frame like Tiptap's `focus()`: keys typed right after Enter
  // must land in the new block.
  editor.chain().setTextSelection(pos).scrollIntoView().run();
  editor.view.focus();
}

/** The text position nearest `x` on the editor's first or last visual line. */
function posAtColumn(editor: Editor, x: number, line: "first" | "last"): number {
  const fallback = line === "first" ? textStart : textEnd(editor);
  const view = editor.view;
  try {
    const edge = view.coordsAtPos(fallback);
    const y = line === "first" ? edge.top + 2 : edge.bottom - 2;
    const hit = view.posAtCoords({ left: x, top: y });
    return hit ? Math.min(Math.max(hit.pos, textStart), textEnd(editor)) : fallback;
  } catch {
    // jsdom (tests) has no layout.
    return fallback;
  }
}

/** Whether the caret sits on the block's first (or last) visual line, for ↑/↓. */
export function caretOnEdgeLine(editor: Editor, edge: "first" | "last"): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const view = editor.view;
  try {
    const here = view.coordsAtPos(selection.head);
    const end = view.coordsAtPos(edge === "first" ? textStart : textEnd(editor));
    // Same line when the vertical ranges overlap.
    return here.top < end.bottom && end.top < here.bottom;
  } catch {
    return edge === "first" ? selection.head === textStart : selection.head === textEnd(editor);
  }
}

/** The caret's horizontal position on screen (for keeping the column across blocks). */
export function caretX(editor: Editor): number | null {
  try {
    return editor.view.coordsAtPos(editor.state.selection.head).left;
  } catch {
    return null;
  }
}

/** Focuses the first block of the editor on screen (Enter or ↓ in the list title). */
export function focusFirstBlock(): boolean {
  const first = document.querySelector<HTMLElement>("[data-block-editor] [data-block-id]");
  const id = first?.dataset.blockId;
  if (!first || !id) return false;
  const atomic = first.querySelector<HTMLElement>("[data-atomic]");
  if (atomic) atomic.focus();
  else if (first.dataset.blockType === "divider")
    first.querySelector<HTMLElement>("[data-atomic]")?.focus();
  else focusBlock(id, "start");
  return true;
}
