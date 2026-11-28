import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

/**
 * The task open in the right panel and the view it was opened from: a list
 * (`/lists/:listId/tasks/:taskId`), the Inbox (`/inbox/tasks/:taskId`) or Today
 * (`/today/tasks/:taskId`, keeping the shown day). Closing returns to that view, and opening a
 * subtask or parent stays in it.
 */
export type PanelTask =
  | { from: "list"; listId: string; taskId: string }
  | { from: "inbox"; taskId: string }
  | { from: "today"; taskId: string; date?: string | undefined };

export function usePanelTaskNav(task: PanelTask) {
  const navigate = useNavigate();
  // Keyed on values, not the object (the shell rebuilds it every render): callers run effects
  // on `close`, and a new function each render would navigate in a loop.
  const { from } = task;
  const listId = task.from === "list" ? task.listId : undefined;
  const date = task.from === "today" ? task.date : undefined;
  const close = useCallback(() => {
    if (from === "list" && listId) {
      void navigate({ to: "/lists/$listId", params: { listId } });
    } else if (from === "today") {
      void navigate({ to: "/today", search: date ? { date } : {} });
    } else {
      void navigate({ to: "/inbox" });
    }
  }, [navigate, from, listId, date]);
  /** Opens another task in the same view (a subtask, its parent). */
  const open = useCallback(
    (taskId: string, targetList?: string | null) => {
      if (from === "list" && targetList) {
        void navigate({
          to: "/lists/$listId/tasks/$taskId",
          params: { listId: targetList, taskId },
        });
      } else if (from === "today") {
        void navigate({
          to: "/today/tasks/$taskId",
          params: { taskId },
          search: date ? { date } : {},
        });
      } else {
        void navigate({ to: "/inbox/tasks/$taskId", params: { taskId } });
      }
    },
    [navigate, from, date],
  );
  return useMemo(() => ({ close, open }), [close, open]);
}
