import type { TaskDue } from "@flolist/shared";
import type { Editor } from "@tiptap/core";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useDateContext } from "./dates.ts";
import { updateSuggestion } from "./suggestion.ts";

/** Returns `suggest(editorId, editor, setDue)`: call it after a task title changes. */
export function useTitleSuggestions() {
  const date = useDateContext();
  const latest = useRef(date);
  useLayoutEffect(() => {
    latest.current = date;
  });
  return useCallback((editorId: string, editor: Editor, setDue: (due: TaskDue) => void) => {
    const ctx = latest.current;
    updateSuggestion({
      editorId,
      editor,
      nl: ctx.nlOptions(),
      today: ctx.now.date,
      timeZone: ctx.timeZone,
      setDue,
    });
  }, []);
}
