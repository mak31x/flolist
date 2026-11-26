import type { BlockStore, FlushDelay, LocalOp } from "./store.ts";
import { inlineToDoc, docToInline, sameInline } from "./content.ts";
import { editorFor, focusBlock, type CaretTarget } from "./focus.ts";

export interface Focus {
  id: string;
  target: CaretTarget;
}

export interface RunOptions {
  delay?: FlushDelay;
  /** Where the caret goes after the command. */
  focus?: Focus | undefined;
  /**
   * Typing in one block: consecutive runs with the same key within a short pause become one
   * undo step.
   */
  coalesce?: string;
}

interface Entry {
  undo: LocalOp[];
  redo: LocalOp[];
  /** The caret before the command (undo puts it back). */
  before: Focus | null;
  /** The caret after it (redo goes there). */
  after: Focus | null;
  coalesce: string | undefined;
  at: number;
}

const MAX_STEPS = 200;
/** A pause longer than this starts a new typing step. */
const TYPING_PAUSE_MS = 1000;

/** The block and text offset of the caret, if a block's text has focus. */
function currentCaret(): Focus | null {
  const el = document.activeElement?.closest<HTMLElement>("[data-block-id]");
  const id = el?.dataset.blockId;
  if (!id) return null;
  const editor = editorFor(id);
  if (!editor) return { id, target: "end" };
  return { id, target: { offset: editor.state.selection.from - 1 } };
}

/**
 * Every editor action goes through `run`: apply the ops (optimistic + queued), record the
 * inverse for undo and move the caret. Undo/redo (Mod+Z / Mod+Shift+Z) replay recorded inverses
 * through the same store, so they are ordinary mutations to the server (lists-and-blocks.md:
 * "a client-side command stack that issues inverse mutations"). The stack lives as long as the
 * open list and is cleared when the store rolls back after a failed save.
 */
export class EditorCommands {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  constructor(
    private readonly store: BlockStore,
    private readonly now: () => number = Date.now,
  ) {
    store.onRollback(() => {
      this.undoStack = [];
      this.redoStack = [];
    });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  run(ops: readonly LocalOp[], options: RunOptions = {}): LocalOp[] {
    const before = currentCaret();
    const inverse = this.store.apply(ops, options.delay ?? "command");
    if (inverse.length > 0) this.record(inverse, [...ops], before, options);
    if (options.focus) focusBlock(options.focus.id, options.focus.target);
    return inverse;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const redo = this.store.apply(entry.undo);
    this.syncEditors(entry.undo);
    this.redoStack.push({ ...entry, redo, coalesce: undefined });
    this.restoreCaret(entry.before ?? entry.after, entry.undo);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const undo = this.store.apply(entry.redo);
    this.syncEditors(entry.redo);
    this.undoStack.push({ ...entry, undo, coalesce: undefined });
    this.restoreCaret(entry.after ?? entry.before, entry.redo);
    return true;
  }

  private record(undo: LocalOp[], redo: LocalOp[], before: Focus | null, options: RunOptions) {
    const at = this.now();
    this.redoStack = [];
    const last = this.undoStack.at(-1);
    if (
      options.coalesce !== undefined &&
      last?.coalesce === options.coalesce &&
      at - last.at < TYPING_PAUSE_MS
    ) {
      // Keep the oldest inverse (the text before the burst); the redo is the latest text.
      last.redo = redo;
      last.at = at;
      last.after = currentCaret();
      return;
    }
    this.undoStack.push({
      undo,
      redo,
      before,
      after: options.focus ?? null,
      coalesce: options.coalesce,
      at,
    });
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
  }

  /** A focused editor ignores cache updates while typing; undo/redo set its text directly. */
  private syncEditors(ops: readonly LocalOp[]) {
    for (const op of ops) {
      const editor = editorFor(op.id);
      const block = this.store.get(op.id);
      if (!editor || editor.isDestroyed || !block || !("inline" in block.content)) continue;
      if (!sameInline(block.content.inline, docToInline(editor.getJSON()))) {
        editor.commands.setContent(inlineToDoc(block.content.inline), { emitUpdate: false });
      }
    }
  }

  private restoreCaret(preferred: Focus | null, ops: readonly LocalOp[]) {
    const target =
      preferred && this.store.get(preferred.id)
        ? preferred
        : (() => {
            const id = ops.map((o) => o.id).find((i) => this.store.get(i));
            return id ? { id, target: "end" as const } : null;
          })();
    if (!target) return;
    const block = this.store.get(target.id);
    if (block?.type === "divider") {
      document
        .querySelector<HTMLElement>(`[data-block-id="${target.id}"] [role="separator"]`)
        ?.focus();
      return;
    }
    focusBlock(target.id, target.target);
  }
}
