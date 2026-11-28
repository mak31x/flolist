import type { Block } from "@flolist/shared";
import { toast } from "@flolist/ui";
import type { QueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  Circle,
  Copy,
  CopyPlus,
  FileText,
  FolderInput,
  Inbox,
  Link2,
  ListX,
  SignalHigh,
  Tag,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { appOrigin, playCompleteSound, writeClipboard } from "../../platform/index.ts";
import type { EditorCommands } from "../editor/commands.ts";
import { moveBlocksTo } from "../editor/media.ts";
import type { PickerKind } from "../properties/picker-store.ts";
import type { InboxActions } from "../task-views/inbox-actions.ts";
import { useMoveTo } from "./move-store.ts";
import {
  completeOps,
  duplicateOps,
  toLinks,
  toMarkdown,
  toPlainText,
  topLevel,
} from "./task-ops.ts";

/**
 * Task actions (tasks.md → Task actions) in one registry: the row context menu, the details ⋮
 * menu and the multiselect action bar all list and run them from here, on one task or many.
 * Add to / Remove from Inbox and Remove from list came with the Inbox (M4.1); Assign comes with
 * M7.3.
 */
export type TaskActionId =
  | "open"
  | "complete"
  | "due"
  | "priority"
  | "labels"
  | "move"
  | "addToInbox"
  | "removeFromInbox"
  | "removeFromList"
  | "duplicate"
  | "copyLink"
  | "copyText"
  | "copyMarkdown"
  | "delete";

/** What an action needs from the place it runs in (a list editor or the details panel). */
export interface TaskActionHost {
  /** The list page the blocks belong to (their home list). */
  /** The list page the actions run on; null on a task page (an Inbox-only task's body). */
  listId: string | null;
  workspaceId: string | undefined;
  qc: QueryClient;
  commands: EditorCommands;
  /** Every cached block of the page. */
  all: () => readonly Block[];
  soundsEnabled: boolean;
  openTask?: (block: Block) => void;
  /** Opens a property picker on one task (anchored to its chip). */
  openPicker?: (block: Block, kind: PickerKind) => void;
  /** After the blocks were deleted or moved away (clear the selection, close the panel). */
  onGone?: () => void;
  /** After Duplicate, with the copies' block ids (select or focus them). */
  onDuplicated?: (ids: string[]) => void;
  /** Inbox membership and Remove from list (M4.1). */
  inbox?: InboxActions;
}

export interface TaskActionItem {
  id: TaskActionId;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  /** Draw a separator above this item. */
  group?: boolean;
}

/**
 * The actions that apply to `targets`, in menu order. Picker actions (due date, priority,
 * labels) and Open details need a single task; the selection bar has its own pickers.
 */
export function taskActionItems(
  targets: readonly Block[],
  host: Pick<TaskActionHost, "openTask" | "openPicker" | "listId" | "inbox">,
): TaskActionItem[] {
  const tasks = targets.filter((b) => b.type === "task");
  const single = targets.length === 1 && tasks.length === 1 ? tasks[0] : undefined;
  const allDone = tasks.length > 0 && tasks.every((b) => b.task?.completedAt != null);
  const items: TaskActionItem[] = [];
  if (single && host.openTask) {
    items.push({
      id: "open",
      label: t("tasks.actions.open"),
      icon: <ArrowRight />,
      shortcut: "Mod+Enter",
    });
  }
  if (tasks.length > 0) {
    items.push({
      id: "complete",
      label: t(allDone ? "tasks.actions.reopen" : "tasks.actions.complete"),
      icon: allDone ? <Circle /> : <CircleCheck />,
      shortcut: "Mod+D",
    });
  }
  if (single && host.openPicker) {
    items.push(
      { id: "due", label: t("tasks.actions.due"), icon: <CalendarDays />, group: true },
      { id: "priority", label: t("tasks.actions.priority"), icon: <SignalHigh /> },
      { id: "labels", label: t("tasks.actions.labels"), icon: <Tag /> },
    );
  }
  // A task page (an Inbox-only task's body) has no list to move from (M4.1: the Inbox view
  // moves whole tasks itself).
  if (host.listId) {
    items.push({ id: "move", label: t("tasks.actions.move"), icon: <FolderInput />, group: true });
  }
  const { inbox } = host;
  if (inbox && tasks.length > 0) {
    const inInbox = tasks.every((b) => b.taskId && inbox.has(b.taskId));
    // Tasks in no list stay in the Inbox (D-075), so Remove needs a list page.
    if (inInbox && host.listId) {
      items.push({
        id: "removeFromInbox",
        label: t("tasks.actions.removeFromInbox"),
        icon: <Inbox />,
        group: !host.listId,
      });
    } else if (!inInbox) {
      items.push({
        id: "addToInbox",
        label: t("tasks.actions.addToInbox"),
        icon: <Inbox />,
        shortcut: "Mod+Shift+I",
      });
    }
    if (host.listId) {
      items.push({
        id: "removeFromList",
        label: t("tasks.actions.removeFromList"),
        icon: <ListX />,
        shortcut: "Mod+Shift+R",
      });
    }
  }
  items.push({
    id: "duplicate",
    label: t("tasks.actions.duplicate"),
    icon: <CopyPlus />,
    shortcut: "Mod+Shift+D",
  });
  if (tasks.length > 0) {
    items.push({
      id: "copyLink",
      label: t(tasks.length > 1 ? "tasks.actions.copyLinks" : "tasks.actions.copyLink"),
      icon: <Link2 />,
      group: true,
    });
  }
  items.push(
    { id: "copyText", label: t("tasks.actions.copyText"), icon: <Copy /> },
    { id: "copyMarkdown", label: t("tasks.actions.copyMarkdown"), icon: <FileText /> },
    {
      id: "delete",
      label: t("tasks.actions.delete"),
      icon: <Trash2 />,
      shortcut: "Mod+Backspace",
      destructive: true,
      group: true,
    },
  );
  return items;
}

async function copy(text: string) {
  toast(t((await writeClipboard(text)) ? "tasks.actions.copied" : "tasks.actions.copyFailed"));
}

/** Deletes the blocks as one undo step, with an Undo toast. */
export function deleteBlocks(host: TaskActionHost, targets: readonly Block[]): void {
  const top = topLevel(host.all(), targets);
  if (top.length === 0) return;
  const inverse = host.commands.run(top.map((b) => ({ op: "delete", id: b.id })));
  host.onGone?.();
  toast(t("tasks.actions.deleted", { count: top.length }), {
    action: {
      label: t("tasks.details.undo"),
      onAction: () => {
        host.commands.run(inverse);
      },
    },
  });
}

/** Mark complete / incomplete (Mod+D), playing the sound when something gets completed. */
export function toggleComplete(
  host: TaskActionHost,
  targets: readonly Block[],
  completed?: boolean,
) {
  const result = completeOps(targets, completed);
  if (result.ops.length === 0) return;
  host.commands.run(result.ops);
  if (result.completed && host.soundsEnabled) playCompleteSound();
}

/** Duplicate (Mod+Shift+D): copies right below each original, one undo step. */
export function duplicateBlocks(host: TaskActionHost, targets: readonly Block[]): void {
  const { ops, ids } = duplicateOps(host.all(), targets);
  if (ops.length === 0) return;
  host.commands.run(ops);
  host.onDuplicated?.(ids);
}

/** Opens the Move to list dialog for `targets`. */
export function askMoveTo(host: TaskActionHost, targets: readonly Block[]): void {
  const { workspaceId, listId } = host;
  if (!workspaceId || !listId || targets.length === 0) return;
  const ids = topLevel(host.all(), targets).map((b) => b.id);
  useMoveTo.getState().open({
    fromListId: listId,
    workspaceId,
    onPick: (target) => {
      void moveBlocksTo({ ...host, listId }, ids, target).then((moved) => {
        if (moved) host.onGone?.();
      });
    },
  });
}

export function runTaskAction(
  id: TaskActionId,
  targets: readonly Block[],
  host: TaskActionHost,
): void {
  const first = targets[0];
  switch (id) {
    case "open":
      if (first) host.openTask?.(first);
      return;
    case "complete":
      toggleComplete(host, targets);
      return;
    case "due":
    case "priority":
    case "labels":
      if (first) host.openPicker?.(first, id);
      return;
    case "move":
      askMoveTo(host, targets);
      return;
    case "duplicate":
      duplicateBlocks(host, targets);
      return;
    case "copyLink":
      void copy(toLinks(appOrigin(), host.listId, targets));
      return;
    case "copyText":
      void copy(toPlainText(host.all(), targets));
      return;
    case "copyMarkdown":
      void copy(toMarkdown(host.all(), targets));
      return;
    case "addToInbox":
      addToInbox(host, targets);
      return;
    case "removeFromInbox":
      host.inbox?.remove(taskIdsOf(targets));
      return;
    case "removeFromList":
      removeFromList(host, targets);
      return;
    case "delete":
      deleteBlocks(host, targets);
      return;
  }
}

/** Add to Inbox (⌘⇧I) once the page's pending edits are saved (a just-typed task exists). */
export function addToInbox(host: TaskActionHost, targets: readonly Block[]): void {
  const ids = taskIdsOf(targets);
  if (!host.inbox || ids.length === 0) return;
  const { inbox } = host;
  void host.commands.flush().then(() => {
    inbox.add(ids);
  });
}

const taskIdsOf = (targets: readonly Block[]) =>
  targets.flatMap((b) => (b.type === "task" && b.taskId ? [b.taskId] : []));

/**
 * Remove from list (⌘⇧R): each top-level task picked leaves the list for the Inbox with its
 * subtasks; its rows leave the page at once.
 */
export function removeFromList(host: TaskActionHost, targets: readonly Block[]): void {
  if (!host.inbox || !host.listId) return;
  const all = host.all();
  const top = topLevel(all, targets).filter((b) => b.type === "task" && b.taskId);
  if (top.length === 0) return;
  const below = (taskId: string): string[] =>
    all
      .filter((b) => b.containerType === "task" && b.containerId === taskId)
      .flatMap((b) => [b.id, ...(b.taskId ? below(b.taskId) : [])]);
  const { inbox } = host;
  const moves = top.map((b) => ({
    taskId: b.taskId ?? "",
    blockIds: [b.id, ...below(b.taskId ?? "")],
  }));
  host.onGone?.();
  // Pending edits first: the server must know the tasks (and their titles) before they move.
  void host.commands.flush().then(() => {
    inbox.removeFromList(moves);
  });
}
