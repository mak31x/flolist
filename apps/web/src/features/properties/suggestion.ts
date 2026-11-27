import {
  findNaturalDates,
  formatDue,
  type NaturalDateMatch,
  type NaturalDateOptions,
  type TaskDue,
} from "@flolist/shared";
import type { Editor } from "@tiptap/core";
import { create } from "zustand";

/**
 * The natural-language date suggestion (tasks.md → Natural-language dates): while a task title
 * ends (at the caret) with a date phrase, a popover under the caret offers it. Return, a click
 * or a tap accepts: the phrase leaves the title and the due date is set. Esc, or typing on,
 * ignores it. Repeats ("every monday") are parsed but only offered once recurring tasks exist
 * (M5.1).
 */
export interface DateSuggestion {
  /** The editor's id (a row's block id, or the details title's). */
  editorId: string;
  match: NaturalDateMatch;
  /** "Tomorrow 5:00 pm". */
  label: string;
  /** Viewport position under the phrase's end. */
  left: number;
  top: number;
  accept: () => void;
}

interface SuggestionState {
  current: DateSuggestion | null;
  /** The phrase Esc dismissed, so it stays hidden until the text changes. */
  dismissed: { editorId: string; index: number; text: string } | null;
}

export const useSuggestion = create<SuggestionState>()(() => ({ current: null, dismissed: null }));

const textOf = (editor: Editor, to: number) =>
  editor.state.doc.textBetween(1, Math.max(1, to), "\n", "\n");

/**
 * The phrase that ends at the caret (only whitespace may follow it before the caret), if any.
 * Offsets map 1:1 to positions inside the title's one paragraph (`pos = offset + 1`).
 */
export function phraseAtCaret(
  text: string,
  caret: number,
  opts: NaturalDateOptions,
): NaturalDateMatch | null {
  const matches = findNaturalDates(text, opts).filter((m) => !m.rrule);
  return matches.find((m) => m.end <= caret && text.slice(m.end, caret).trim() === "") ?? null;
}

export interface SuggestOptions {
  editorId: string;
  editor: Editor;
  nl: NaturalDateOptions;
  today: string;
  timeZone: string;
  setDue: (due: TaskDue) => void;
}

/** Recomputes the suggestion after the title changed or the caret moved. */
export function updateSuggestion(o: SuggestOptions): void {
  const { editor } = o;
  const { from, empty } = editor.state.selection;
  if (!empty || !editor.isFocused) {
    clearSuggestion(o.editorId);
    return;
  }
  const end = editor.state.doc.content.size - 1;
  const text = textOf(editor, end);
  const caret = from - 1;
  const match = phraseAtCaret(text, caret, o.nl);
  const { dismissed } = useSuggestion.getState();
  if (
    !match ||
    (dismissed?.editorId === o.editorId &&
      dismissed.index === match.index &&
      dismissed.text === match.text)
  ) {
    clearSuggestion(o.editorId);
    return;
  }
  let left = 0;
  let top = 0;
  try {
    const coords = editor.view.coordsAtPos(match.end + 1);
    left = coords.left;
    top = coords.bottom + 4;
  } catch {
    // Not laid out (tests): position stays at the origin.
  }
  useSuggestion.setState({
    current: {
      editorId: o.editorId,
      match,
      label: formatDue({ date: match.date, time: match.time }, o.today),
      left,
      top,
      accept: () => {
        acceptSuggestion(o, match);
      },
    },
  });
}

/** Sets the due date and removes the phrase (and one space next to it) from the title. */
export function acceptSuggestion(o: SuggestOptions, match: NaturalDateMatch): void {
  const text = textOf(o.editor, o.editor.state.doc.content.size - 1);
  let from = match.index;
  let to = match.end;
  if (from > 0 && text[from - 1] === " ") from -= 1;
  else if (text[to] === " ") to += 1;
  o.setDue({ date: match.date, time: match.time, tz: o.timeZone });
  o.editor
    .chain()
    .focus()
    .deleteRange({ from: from + 1, to: to + 1 })
    .run();
  useSuggestion.setState({ current: null, dismissed: null });
}

export function clearSuggestion(editorId?: string): void {
  const { current } = useSuggestion.getState();
  if (current && (!editorId || current.editorId === editorId)) {
    useSuggestion.setState({ current: null });
  }
}

/** Return accepts, Esc dismisses. Returns true when the key was used. */
export function handleSuggestionKey(editorId: string, event: KeyboardEvent): boolean {
  const { current } = useSuggestion.getState();
  if (current?.editorId !== editorId) return false;
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    current.accept();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    useSuggestion.setState({
      current: null,
      dismissed: { editorId, index: current.match.index, text: current.match.text },
    });
    return true;
  }
  return false;
}
