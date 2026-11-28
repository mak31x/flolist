import type { Task } from "@flolist/shared";
import { toast } from "@flolist/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Circle,
  CircleCheck,
  FolderInput,
  Inbox,
  ListX,
  SignalHigh,
  Tag,
  Trash2,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { playCompleteSound } from "../../platform/index.ts";
import { useMe } from "../auth/hooks.ts";
import { blocksApi } from "../editor/api.ts";
import { usePicker } from "../properties/picker-store.ts";
import { useMoveTo } from "../tasks/move-store.ts";
import { inboxKey } from "./api.ts";
import { useInboxActions } from "./inbox-actions.ts";
import { useDeleteViewTasks, useUpdateViewTask } from "./mutations.ts";

/**
 * Task actions for rows of the Inbox and Today (tasks.md → Task actions): the same items as a
 * list row's menu, over `Task`s instead of blocks. Pickers open on the row's own chips.
 */
export type ViewActionId =
  | "open"
  | "complete"
  | "due"
  | "priority"
  | "labels"
  | "addToInbox"
  | "removeFromInbox"
  | "removeFromList"
  | "move"
  | "delete";

interface ViewActionItem {
  id: ViewActionId;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  group?: boolean;
}

export interface ViewActions {
  items: (tasks: readonly Task[]) => ViewActionItem[];
  run: (id: ViewActionId, tasks: readonly Task[]) => void;
}

export function useViewActions(onOpen: (taskId: string) => void): ViewActions {
  const me = useMe();
  const qc = useQueryClient();
  const inbox = useInboxActions();
  const update = useUpdateViewTask(me.id);
  const remove = useDeleteViewTasks();
  return useMemo<ViewActions>(() => {
    const askMove = (tasks: readonly Task[], workspaceId: string) => {
      const from = tasks.length === 1 ? (tasks[0]?.listId ?? "") : "";
      useMoveTo.getState().open({
        fromListId: from,
        workspaceId,
        onPick: (target) => {
          void moveTasks(tasks, target)
            .then(() => {
              toast(t("taskViews.moved", { count: tasks.length }));
            })
            .catch(() => {
              toast(t("taskViews.moveError"));
            })
            .finally(() => {
              void qc.invalidateQueries({ queryKey: inboxKey });
              void qc.invalidateQueries({ queryKey: ["today"] });
            });
        },
      });
    };
    return {
      items: (tasks) => {
        const single = tasks.length === 1 ? tasks[0] : undefined;
        const allDone = tasks.length > 0 && tasks.every((x) => x.completedAt !== null);
        const inInbox = tasks.every((x) => inbox.has(x.id));
        const allListed = tasks.every((x) => x.listId !== null);
        const items: ViewActionItem[] = [];
        if (single) {
          items.push({
            id: "open",
            label: t("tasks.actions.open"),
            icon: <ArrowRight />,
            shortcut: "Mod+Enter",
          });
        }
        items.push({
          id: "complete",
          label: t(allDone ? "tasks.actions.reopen" : "tasks.actions.complete"),
          icon: allDone ? <Circle /> : <CircleCheck />,
          shortcut: "Mod+D",
        });
        if (single) {
          items.push(
            { id: "due", label: t("tasks.actions.due"), icon: <CalendarDays />, group: true },
            { id: "priority", label: t("tasks.actions.priority"), icon: <SignalHigh /> },
            { id: "labels", label: t("tasks.actions.labels"), icon: <Tag /> },
          );
        }
        // Moves need one workspace; tasks in a list and top-level tasks in no list can move.
        const movable =
          new Set(tasks.map((x) => x.workspaceId)).size === 1 &&
          tasks.every((x) => x.listId !== null || x.parentTaskId === null);
        if (movable) {
          items.push({
            id: "move",
            label: t("tasks.actions.move"),
            icon: <FolderInput />,
            group: true,
          });
        }
        if (!inInbox) {
          items.push({
            id: "addToInbox",
            label: t("tasks.actions.addToInbox"),
            icon: <Inbox />,
            shortcut: "Mod+Shift+I",
          });
        } else if (allListed) {
          items.push({
            id: "removeFromInbox",
            label: t("tasks.actions.removeFromInbox"),
            icon: <Inbox />,
          });
        }
        if (allListed) {
          items.push({
            id: "removeFromList",
            label: t("tasks.actions.removeFromList"),
            icon: <ListX />,
            shortcut: "Mod+Shift+R",
          });
        }
        items.push({
          id: "delete",
          label: t("tasks.actions.delete"),
          icon: <Trash2 />,
          shortcut: "Mod+Backspace",
          destructive: true,
          group: true,
        });
        return items;
      },
      run: (id, tasks) => {
        const first = tasks[0];
        switch (id) {
          case "open":
            if (first) onOpen(first.id);
            return;
          case "complete": {
            const completed = !tasks.every((x) => x.completedAt !== null);
            for (const task of tasks) {
              if ((task.completedAt !== null) !== completed) {
                update.mutate({ id: task.id, change: { completed } });
              }
            }
            if (completed && me.soundsEnabled) playCompleteSound();
            return;
          }
          case "due":
          case "priority":
          case "labels":
            if (first) usePicker.getState().setOpen({ blockId: first.id, scope: "row", kind: id });
            return;
          case "addToInbox":
            inbox.add(tasks.filter((x) => !inbox.has(x.id)).map((x) => x.id));
            return;
          case "removeFromInbox":
            inbox.remove(tasks.map((x) => x.id));
            return;
          case "removeFromList":
            inbox.removeFromList(tasks.map((x) => ({ taskId: x.id, blockIds: [] })));
            return;
          case "move":
            if (first) askMove(tasks, first.workspaceId);
            return;
          case "delete":
            void remove(tasks);
            return;
        }
      },
    };
  }, [inbox, update, remove, me.soundsEnabled, onOpen, qc]);
}

/**
 * Moves view tasks onto `target`: tasks in no list through POST /tasks/:id/move, tasks in a list
 * through their list's move-to (grouped by list).
 */
export async function moveTasks(tasks: readonly Task[], target: string): Promise<void> {
  const byList = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.listId === target) continue;
    if (!task.listId) {
      await api("POST", `/tasks/${task.id}/move`, undefined, {
        clientMutationId: crypto.randomUUID(),
        listId: target,
      });
    } else if (task.blockId) {
      byList.set(task.listId, [...(byList.get(task.listId) ?? []), task.blockId]);
    }
  }
  for (const [listId, ids] of byList) {
    await blocksApi.moveTo(listId, {
      clientMutationId: crypto.randomUUID(),
      ids,
      targetListId: target,
    });
  }
}
