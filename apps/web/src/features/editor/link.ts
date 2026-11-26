import type { Editor } from "@tiptap/core";

export interface LinkRequest {
  editor: Editor;
  from: number;
  to: number;
  href: string;
  anchor: { left: number; top: number; height: number };
}

/** What ⌘L asks for: the current selection (or caret) and its link, if any. */
export function linkRequestFor(editor: Editor): LinkRequest {
  const { from, to } = editor.state.selection;
  const href = (editor.getAttributes("link") as { href?: string }).href ?? "";
  let anchor = { left: 0, top: 0, height: 0 };
  try {
    const c = editor.view.coordsAtPos(from);
    anchor = { left: c.left, top: c.top, height: c.bottom - c.top };
  } catch {
    // jsdom has no layout; the popover still opens.
  }
  return { editor, from, to, href, anchor };
}
