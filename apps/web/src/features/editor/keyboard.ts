import {
  MAX_INDENT,
  inlineLength,
  isIndentable,
  isReferenceBlockType,
  isTextBlockType,
  normalizeInline,
  positionBetween,
  positionsBetween,
  type Block,
  type BlockDraft,
  type BlockType,
  type InlineNode,
  uuidv7,
} from "@flolist/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { Editor, JSONContent } from "@tiptap/core";
import type { BlockAction } from "./BlockHandle.tsx";
import type { EditorCommands } from "./commands.ts";
import { docToInline, inlineToDoc } from "./content.ts";
import { caretOnEdgeLine, caretX, editorFor, focusBlock } from "./focus.ts";
import { historyKey, isMod } from "./keys.ts";
import { focusAtomic, insertReference } from "./media.ts";
import { markdownShortcut } from "./slash.ts";
import type { BlockFields, LocalOp } from "./store.ts";

export interface KeyContext {
  listId: string;
  rootListId: string;
  /** Where uploads go (the list's workspace; a just-created list may still be saving). */
  workspaceId: () => Promise<string>;
  qc: QueryClient;
  /** The blocks in order, as of now (including the unsaved placeholder of an empty list). */
  rows: () => readonly Block[];
  /** Whether the server/store knows this block yet (the placeholder doesn't). */
  isSaved: (id: string) => boolean;
  commands: EditorCommands;
  /** ↑ from the first block moves into the list title. */
  focusTitle: () => void;
  /**
   * Block selection (Esc, Mod+A twice, Shift+↑/↓ at a block's edge): a range from `anchor` to
   * `head`. While it's active the editor container has focus and takes the keys.
   */
  selection: {
    get: () => { anchor: string; head: string } | null;
    set: (anchor: string, head: string) => void;
    clear: () => void;
  };
  /** The slash menu: opened by "/" at the start of a block; it takes keys while open. */
  slash: {
    open: (block: Block, editor: Editor) => void;
    /** Handles a key while the menu is open for this block; true if it took it. */
    onKey: (block: Block, event: KeyboardEvent) => boolean;
  };
}

/** Types whose Enter makes another block of the same type (lists-and-blocks.md). */
const CONTINUES: ReadonlySet<BlockType> = new Set(["bullet", "numbered", "quote"]);

const inlineOf = (block: Block): InlineNode[] =>
  "inline" in block.content ? block.content.inline : [];

/** An upsert that also creates the block when it isn't saved yet. */
function upsert(ctx: KeyContext, block: Block, fields: BlockFields): LocalOp {
  return {
    op: "upsert",
    id: block.id,
    fields: ctx.isSaved(block.id)
      ? fields
      : {
          type: block.type,
          position: block.position,
          indent: block.indent,
          content: block.content,
          ...fields,
        },
  };
}

function neighbours(ctx: KeyContext, id: string) {
  const rows = ctx.rows();
  const index = rows.findIndex((b) => b.id === id);
  return { rows, index, prev: rows[index - 1], next: rows[index + 1] };
}

/** The text before and after the selection (the selection itself is dropped). */
function splitText(editor: Editor): { before: InlineNode[]; after: InlineNode[] } {
  const { doc, selection } = editor.state;
  const end = doc.content.size - 1;
  // A slice inside the paragraph holds its inline nodes directly (`toJSON` is null when empty).
  const part = (from: number, to: number): InlineNode[] => {
    if (from >= to) return [];
    const inline = (doc.slice(from, to).content.toJSON() ?? []) as JSONContent[];
    return docToInline({ type: "doc", content: [{ type: "paragraph", content: inline }] });
  };
  return { before: part(1, selection.from), after: part(selection.to, end) };
}

const atStart = (editor: Editor) =>
  editor.state.selection.empty && editor.state.selection.from === 1;
const atEnd = (editor: Editor) =>
  editor.state.selection.empty && editor.state.selection.from === editor.state.doc.content.size - 1;

/** Blocks without text (dividers, media, sublists) are focused as a whole. */
export const isAtomic = (block: Block) => !isTextBlockType(block.type);

/** Focuses a block next to `id`: a text block at `target`, any other block as a whole. */
export function focusNeighbour(
  block: Block | undefined,
  target: Parameters<typeof focusBlock>[1],
): boolean {
  if (!block) return false;
  if (isAtomic(block)) {
    focusAtomic(block.id);
    return true;
  }
  focusBlock(block.id, target);
  return true;
}

function setText(editor: Editor | undefined, inline: readonly InlineNode[]) {
  editor?.commands.setContent(inlineToDoc(inline), { emitUpdate: false });
}

function enter(ctx: KeyContext, block: Block, editor: Editor): boolean {
  const { next } = neighbours(ctx, block.id);
  const text = docToInline(editor.getJSON());

  // Enter on an empty list item or quote turns it into a paragraph.
  if (text.length === 0 && CONTINUES.has(block.type)) {
    ctx.commands.run([upsert(ctx, block, { type: "paragraph" })], {
      focus: { id: block.id, target: "start" },
    });
    return true;
  }

  const { prev } = neighbours(ctx, block.id);
  const newId = uuidv7();
  // At the very start of a non-empty block: open an empty block above, keep the caret here.
  if (atStart(editor) && text.length > 0) {
    const position = positionBetween(prev?.position ?? null, block.position);
    ctx.commands.run(
      [
        upsert(ctx, block, {}),
        {
          op: "upsert",
          id: newId,
          fields: {
            type: CONTINUES.has(block.type) ? block.type : "paragraph",
            position,
            indent: block.indent,
            content: { inline: [] },
          },
        },
      ],
      { focus: { id: block.id, target: "start" } },
    );
    return true;
  }

  const { before, after } = splitText(editor);
  const atTheEnd = after.length === 0;
  const type: BlockType = CONTINUES.has(block.type) || !atTheEnd ? block.type : "paragraph";
  setText(editor, before);
  ctx.commands.run(
    [
      upsert(ctx, block, { content: { inline: before } }),
      {
        op: "upsert",
        id: newId,
        fields: {
          type,
          position: positionBetween(block.position, next?.position ?? null),
          indent: isIndentable(type) ? block.indent : 0,
          content: { inline: after },
        },
      },
    ],
    { focus: { id: newId, target: "start" } },
  );
  return true;
}

/** Joins `from` onto the end of `into` (both text blocks) and puts the caret at the seam. */
function merge(ctx: KeyContext, into: Block, from: Block, fromText: InlineNode[]): void {
  const intoText = editorFor(into.id)
    ? docToInline((editorFor(into.id) as Editor).getJSON())
    : inlineOf(into);
  const joined = normalizeInline([...intoText, ...fromText]);
  setText(editorFor(into.id), joined);
  ctx.commands.run(
    [upsert(ctx, into, { content: { inline: joined } }), { op: "delete", id: from.id }],
    { focus: { id: into.id, target: { offset: inlineLength(intoText) } } },
  );
}

function backspace(ctx: KeyContext, block: Block, editor: Editor): boolean {
  if (!atStart(editor)) return false;
  // A non-paragraph block becomes a paragraph first.
  if (block.type !== "paragraph") {
    ctx.commands.run([upsert(ctx, block, { type: "paragraph" })], {
      focus: { id: block.id, target: "start" },
    });
    return true;
  }
  const { prev } = neighbours(ctx, block.id);
  if (!prev) return true;
  const text = docToInline(editor.getJSON());
  // Backspace after a divider removes the divider [assumption]; after media or a sublist it
  // selects that block first, so a second Backspace deletes it.
  if (prev.type === "divider") {
    ctx.commands.run([{ op: "delete", id: prev.id }], { focus: { id: block.id, target: "start" } });
    return true;
  }
  if (isAtomic(prev)) return focusNeighbour(prev, "end");
  if (!ctx.isSaved(block.id) && text.length === 0) return true;
  merge(ctx, prev, block, text);
  return true;
}

function forwardDelete(ctx: KeyContext, block: Block, editor: Editor): boolean {
  if (!atEnd(editor)) return false;
  const { next } = neighbours(ctx, block.id);
  if (!next) return true;
  if (next.type === "divider") {
    ctx.commands.run([{ op: "delete", id: next.id }], { focus: { id: block.id, target: "end" } });
    return true;
  }
  if (isAtomic(next)) return focusNeighbour(next, "start");
  const nextText = editorFor(next.id)
    ? docToInline((editorFor(next.id) as Editor).getJSON())
    : inlineOf(next);
  merge(ctx, block, next, nextText);
  return true;
}

function indent(ctx: KeyContext, block: Block, by: 1 | -1): boolean {
  if (!isIndentable(block.type)) return false;
  const { prev } = neighbours(ctx, block.id);
  // One level deeper than the item above at most [assumption].
  const max = prev && isIndentable(prev.type) ? Math.min(MAX_INDENT, prev.indent + 1) : 0;
  const next = Math.max(0, Math.min(max, block.indent + by));
  if (next !== block.indent) ctx.commands.run([upsert(ctx, block, { indent: next })]);
  return true;
}

/** The block's text with `[from, to)` (text positions) removed. */
function textWithout(editor: Editor, from: number, to: number): InlineNode[] {
  const { doc } = editor.state;
  const end = doc.content.size - 1;
  const slice = (a: number, b: number) =>
    a >= b ? [] : ((doc.slice(a, b).content.toJSON() ?? []) as JSONContent[]);
  return docToInline({
    type: "doc",
    content: [{ type: "paragraph", content: [...slice(1, from), ...slice(to, end)] }],
  });
}

/**
 * Turns a block into another type (slash menu, Markdown shortcuts, "Turn into"). `remove` is a
 * text range to drop first (the typed "/query" or "## "). A divider can't hold text: an empty
 * block becomes the divider and a paragraph opens below it; otherwise the divider goes below.
 */
export function turnInto(
  ctx: KeyContext,
  block: Block,
  type: BlockType,
  editor?: Editor,
  remove?: { from: number; to: number },
): void {
  const text = editor
    ? remove
      ? textWithout(editor, remove.from, remove.to)
      : docToInline(editor.getJSON())
    : inlineOf(block);
  const caret = remove ? { offset: Math.max(0, remove.from - 1) } : "end";
  const { next } = neighbours(ctx, block.id);
  if (isReferenceBlockType(block.type)) return;
  if (isReferenceBlockType(type)) {
    // Media and sublists are new blocks of their own below this one (they replace it when
    // it's an empty paragraph).
    if (remove) {
      setText(editor, text);
      if (ctx.isSaved(block.id)) {
        ctx.commands.run([upsert(ctx, block, { content: { inline: text } })]);
      }
    }
    const replace = text.length === 0 && block.type === "paragraph";
    const anchor = ctx.rows().find((b) => b.id === block.id) ?? block;
    void insertReference(ctx, anchor, type as "image" | "attachment" | "sublist", replace);
    return;
  }
  if (type === "divider") {
    const after = positionBetween(block.position, next?.position ?? null);
    const paragraph = uuidv7();
    if (text.length === 0) {
      ctx.commands.run(
        [
          upsert(ctx, block, { type: "divider" }),
          {
            op: "upsert",
            id: paragraph,
            fields: { type: "paragraph", position: after, indent: 0, content: { inline: [] } },
          },
        ],
        { focus: { id: paragraph, target: "start" } },
      );
      return;
    }
    if (remove) setText(editor, text);
    ctx.commands.run(
      [
        upsert(ctx, block, { content: { inline: text } }),
        { op: "upsert", id: paragraph, fields: { type: "divider", position: after, indent: 0 } },
      ],
      { focus: { id: block.id, target: caret } },
    );
    return;
  }
  if (remove) setText(editor, text);
  ctx.commands.run([upsert(ctx, block, { type, content: { inline: text } })], {
    focus: { id: block.id, target: caret },
  });
}

/** "## " and friends at the start of a paragraph (the space isn't typed yet). */
function shortcutOnSpace(ctx: KeyContext, block: Block, editor: Editor): boolean {
  if (block.type !== "paragraph") return false;
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const prefix = editor.state.doc.textBetween(1, selection.from, "\n");
  const type = markdownShortcut(prefix);
  if (!type) return false;
  turnInto(ctx, block, type, editor, { from: 1, to: selection.from });
  return true;
}

/** "---" in an otherwise empty paragraph makes a divider (on the third dash). */
function dividerOnDash(ctx: KeyContext, block: Block, editor: Editor): boolean {
  if (block.type !== "paragraph") return false;
  const { doc, selection } = editor.state;
  if (!selection.empty || doc.textContent !== "--" || selection.from !== 3) return false;
  turnInto(ctx, block, "divider", editor, { from: 1, to: 3 });
  return true;
}

/** The selected blocks, top to bottom. */
export function selectedBlocks(ctx: KeyContext): Block[] {
  const sel = ctx.selection.get();
  if (!sel) return [];
  const rows = ctx.rows();
  const a = rows.findIndex((b) => b.id === sel.anchor);
  const h = rows.findIndex((b) => b.id === sel.head);
  if (a === -1 || h === -1) return [];
  return rows.slice(Math.min(a, h), Math.max(a, h) + 1);
}

/** Deletes the selected blocks and puts the caret next to where they were. */
export function deleteSelection(ctx: KeyContext): void {
  const selected = selectedBlocks(ctx);
  const top = selected[0];
  const bottom = selected.at(-1);
  if (!top || !bottom) return;
  const before = neighbours(ctx, top.id).prev;
  const after = neighbours(ctx, bottom.id).next;
  ctx.selection.clear();
  ctx.commands.run(selected.map((b) => ({ op: "delete", id: b.id })));
  if (!focusNeighbour(before, "end")) focusNeighbour(after, "start");
}

/** New block ops for `drafts`, placed between two positions. */
function insertOps(drafts: readonly BlockDraft[], after: string | null, before: string | null) {
  const positions = positionsBetween(after, before, drafts.length);
  return drafts.map((d, i) => ({
    id: uuidv7(),
    op: {
      type: d.type,
      position: positions[i] as string,
      indent: isIndentable(d.type) ? d.indent : 0,
      content: d.content,
      ...(d.fileId ? { fileId: d.fileId } : {}),
    } satisfies BlockFields,
  }));
}

/** Pasted blocks go below the selection and become the new selection [assumption]. */
export function pasteAfterSelection(ctx: KeyContext, drafts: readonly BlockDraft[]): void {
  const bottom = selectedBlocks(ctx).at(-1);
  if (!bottom || drafts.length === 0) return;
  const { next } = neighbours(ctx, bottom.id);
  const inserted = insertOps(drafts, bottom.position, next?.position ?? null);
  ctx.commands.run(inserted.map((b) => ({ op: "upsert", id: b.id, fields: b.op })));
  const first = inserted[0];
  const last = inserted.at(-1);
  if (first && last) ctx.selection.set(first.id, last.id);
}

/**
 * Pasting several blocks into a text block (one block is left to Tiptap). The text before the
 * caret keeps its block, the first pasted text joins it (or an empty block takes the pasted
 * block's type), the rest follow, and the text after the caret ends up after the paste.
 */
export function pasteIntoBlock(
  ctx: KeyContext,
  block: Block,
  editor: Editor,
  drafts: readonly BlockDraft[],
): void {
  const [first, ...rest] = drafts;
  if (!first) return;
  const { before, after } = splitText(editor);
  const { next } = neighbours(ctx, block.id);
  const ops: LocalOp[] = [];
  const queue: BlockDraft[] = [];
  const firstInline = "inline" in first.content ? first.content.inline : null;

  // An empty block takes the first pasted block's type, unless that's media (a new block).
  if (before.length === 0 && after.length === 0 && !isReferenceBlockType(first.type)) {
    setText(editor, firstInline ?? []);
    ops.push(
      upsert(ctx, block, { type: first.type, indent: first.indent, content: first.content }),
    );
    queue.push(...rest);
  } else if (firstInline && block.type !== "divider") {
    const joined = normalizeInline([...before, ...firstInline]);
    setText(editor, joined);
    ops.push(upsert(ctx, block, { content: { inline: joined } }));
    queue.push(...rest);
  } else {
    setText(editor, before);
    ops.push(upsert(ctx, block, { content: { inline: before } }));
    queue.push(first, ...rest);
  }

  let caretOffset: number | null = null;
  if (after.length > 0) {
    const last = queue.at(-1);
    if (last && "inline" in last.content) {
      caretOffset = inlineLength(last.content.inline);
      queue[queue.length - 1] = {
        ...last,
        content: { inline: normalizeInline([...last.content.inline, ...after]) },
      };
    } else {
      caretOffset = 0;
      queue.push({ type: "paragraph", indent: 0, content: { inline: after } });
    }
  }

  const inserted = insertOps(queue, block.position, next?.position ?? null);
  for (const b of inserted) ops.push({ op: "upsert", id: b.id, fields: b.op });
  const target = inserted.at(-1);
  ctx.commands.run(ops, {
    focus: target
      ? { id: target.id, target: caretOffset === null ? "end" : { offset: caretOffset } }
      : { id: block.id, target: "end" },
  });
}

/** Mod+Z / Mod+Shift+Z anywhere in the editor. */
function history(ctx: KeyContext, event: KeyboardEvent): boolean {
  const action = historyKey(event);
  if (!action) return false;
  event.preventDefault();
  ctx.selection.clear();
  if (action === "undo") ctx.commands.undo();
  else ctx.commands.redo();
  return true;
}

/** Keys while blocks are selected (the editor container has focus). */
export function handleSelectionKey(ctx: KeyContext, event: KeyboardEvent): boolean {
  if (history(ctx, event)) return true;
  const sel = ctx.selection.get();
  if (!sel || event.isComposing) return false;
  const rows = ctx.rows();
  const selected = selectedBlocks(ctx);
  const top = selected[0];
  const bottom = selected.at(-1);
  if (!top || !bottom) return false;
  const headIndex = rows.findIndex((b) => b.id === sel.head);

  if (isMod(event) && event.key.toLowerCase() === "a" && !event.shiftKey) {
    const first = rows[0];
    const last = rows.at(-1);
    if (first && last) ctx.selection.set(first.id, last.id);
    return true;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return false;

  switch (event.key) {
    case "ArrowUp":
    case "ArrowDown": {
      const up = event.key === "ArrowUp";
      if (event.shiftKey) {
        const head = rows[headIndex + (up ? -1 : 1)];
        if (head) ctx.selection.set(sel.anchor, head.id);
      } else {
        const target = up
          ? (rows[rows.indexOf(top) - 1] ?? top)
          : (rows[rows.indexOf(bottom) + 1] ?? bottom);
        ctx.selection.set(target.id, target.id);
      }
      return true;
    }
    case "Escape":
    case "Enter": {
      const head = rows[headIndex];
      ctx.selection.clear();
      focusNeighbour(head, "end");
      return true;
    }
    case "Backspace":
    case "Delete":
      deleteSelection(ctx);
      return true;
    case "Tab": {
      const by = event.shiftKey ? -1 : 1;
      const ops = selected
        .filter((b) => isIndentable(b.type))
        .map((b) => ({ b, indent: Math.max(0, Math.min(MAX_INDENT, b.indent + by)) }))
        .filter(({ b, indent }) => indent !== b.indent)
        .map(({ b, indent }): LocalOp => ({ op: "upsert", id: b.id, fields: { indent } }));
      if (ops.length > 0) ctx.commands.run(ops);
      return true;
    }
    default:
      return false;
  }
}

/** Shift+↑/↓ at a block's edge, Esc, and Mod+A on fully selected text start a block selection. */
function startSelection(
  ctx: KeyContext,
  block: Block,
  event: KeyboardEvent,
  editor: Editor | null,
): boolean {
  const { prev, next, rows } = neighbours(ctx, block.id);
  if (event.key === "Escape" && !event.shiftKey && !event.altKey && !isMod(event)) {
    ctx.selection.set(block.id, block.id);
    return true;
  }
  if (isMod(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
    const whole =
      !editor ||
      editor.state.doc.textContent.length === 0 ||
      (editor.state.selection.from <= 1 &&
        editor.state.selection.to >= editor.state.doc.content.size - 1);
    if (!whole) return false;
    const first = rows[0];
    const last = rows.at(-1);
    if (first && last) ctx.selection.set(first.id, last.id);
    return true;
  }
  if (
    event.shiftKey &&
    !event.altKey &&
    !isMod(event) &&
    (event.key === "ArrowUp" || event.key === "ArrowDown")
  ) {
    const up = event.key === "ArrowUp";
    if (editor && !headOnEdgeLine(editor, up ? "first" : "last")) return false;
    const other = up ? prev : next;
    ctx.selection.set(block.id, other?.id ?? block.id);
    return true;
  }
  return false;
}

/** Like `caretOnEdgeLine`, but for the moving end of a (possibly non-empty) text selection. */
function headOnEdgeLine(editor: Editor, edge: "first" | "last"): boolean {
  const { head } = editor.state.selection;
  const end = editor.state.doc.content.size - 1;
  try {
    const here = editor.view.coordsAtPos(head);
    const limit = editor.view.coordsAtPos(edge === "first" ? 1 : end);
    return here.top < limit.bottom && limit.top < here.bottom;
  } catch {
    return edge === "first" ? head <= 1 : head >= end;
  }
}

/**
 * Keys that move between or reshape blocks (lists-and-blocks.md → Editor behaviour). Returns
 * true when it handled the key; anything else is left to the block's own Tiptap editor.
 */
export function handleBlockKey(
  ctx: KeyContext,
  block: Block,
  event: KeyboardEvent,
  editor: Editor,
): boolean {
  if (event.isComposing) return false;
  if (ctx.slash.onKey(block, event)) return true;
  if (history(ctx, event)) return true;
  if (startSelection(ctx, block, event, editor)) return true;
  const plain = !event.altKey && !event.ctrlKey && !event.metaKey;

  switch (event.key) {
    case " ":
      return plain && !event.shiftKey ? shortcutOnSpace(ctx, block, editor) : false;
    case "-":
      return plain ? dividerOnDash(ctx, block, editor) : false;
    case "/":
      // The menu opens now; the "/" itself is typed by the default handling right after.
      if (plain && atStart(editor)) ctx.slash.open(block, editor);
      return false;
    case "Enter":
      return plain && !event.shiftKey ? enter(ctx, block, editor) : false;
    case "Backspace":
      return plain && !event.shiftKey ? backspace(ctx, block, editor) : false;
    case "Delete":
      return plain && !event.shiftKey ? forwardDelete(ctx, block, editor) : false;
    case "Tab":
      if (event.altKey || event.ctrlKey || event.metaKey) return false;
      if (!indent(ctx, block, event.shiftKey ? -1 : 1)) return false;
      event.preventDefault();
      return true;
    case "ArrowUp":
    case "ArrowDown": {
      if (!plain || event.shiftKey) return false;
      const up = event.key === "ArrowUp";
      if (!caretOnEdgeLine(editor, up ? "first" : "last")) return false;
      const { prev, next, index } = neighbours(ctx, block.id);
      const x = caretX(editor);
      const target =
        x === null
          ? up
            ? "end"
            : "start"
          : { x, line: up ? ("last" as const) : ("first" as const) };
      if (up && index === 0) {
        ctx.focusTitle();
        return true;
      }
      return focusNeighbour(up ? prev : next, target);
    }
    case "ArrowLeft":
      if (!plain || event.shiftKey || !atStart(editor)) return false;
      return focusNeighbour(neighbours(ctx, block.id).prev, "end");
    case "ArrowRight":
      if (!plain || event.shiftKey || !atEnd(editor)) return false;
      return focusNeighbour(neighbours(ctx, block.id).next, "start");
    default:
      return false;
  }
}

/** Keys on a focused divider, media or sublist block: move, delete, or open a paragraph below. */
export function handleDividerKey(ctx: KeyContext, block: Block, event: KeyboardEvent): boolean {
  if (history(ctx, event)) return true;
  if (startSelection(ctx, block, event, null)) return true;
  if (isMod(event) || event.altKey || event.shiftKey) return false;
  const { prev, next } = neighbours(ctx, block.id);
  switch (event.key) {
    case "ArrowUp":
    case "ArrowLeft":
      if (!prev) ctx.focusTitle();
      return focusNeighbour(prev, "end") || true;
    case "ArrowDown":
    case "ArrowRight":
      return focusNeighbour(next, "start") || true;
    case "Backspace":
    case "Delete": {
      const target = event.key === "Backspace" ? (prev ?? next) : (next ?? prev);
      ctx.commands.run([{ op: "delete", id: block.id }]);
      focusNeighbour(target, event.key === "Backspace" && target === prev ? "end" : "start");
      return true;
    }
    case "Enter": {
      const id = uuidv7();
      ctx.commands.run(
        [
          {
            op: "upsert",
            id,
            fields: {
              type: "paragraph",
              position: positionBetween(block.position, next?.position ?? null),
              indent: 0,
              content: { inline: [] },
            },
          },
        ],
        { focus: { id, target: "start" } },
      );
      return true;
    }
    default:
      return false;
  }
}

/** The block menu's actions (Turn into, divider colour, Duplicate, Delete). */
export function blockAction(ctx: KeyContext, block: Block, action: BlockAction): void {
  const { prev, next } = neighbours(ctx, block.id);
  switch (action.kind) {
    case "turnInto":
      turnInto(ctx, block, action.type, editorFor(block.id));
      return;
    case "color":
      ctx.commands.run([upsert(ctx, block, { content: { color: action.color } })]);
      return;
    case "duplicate": {
      const id = uuidv7();
      const current = ctx.rows().find((b) => b.id === block.id) ?? block;
      // A sublist is a whole list: Duplicate list (its own ⋮ menu) copies it.
      if (current.type === "sublist") return;
      ctx.commands.run(
        [
          {
            op: "upsert",
            id,
            fields: {
              type: current.type,
              position: positionBetween(current.position, next?.position ?? null),
              indent: current.indent,
              content: current.content,
              ...(current.fileId ? { fileId: current.fileId } : {}),
            },
          },
        ],
        isAtomic(current) ? {} : { focus: { id, target: "end" } },
      );
      if (isAtomic(current)) focusAtomic(id);
      return;
    }
    case "delete":
      ctx.commands.run([{ op: "delete", id: block.id }]);
      if (!focusNeighbour(prev, "end")) focusNeighbour(next, "start");
      return;
  }
}
