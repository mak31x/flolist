import type { Block, TaskDue } from "@flolist/shared";
import { isApplePlatform } from "@flolist/ui";
import type { BlockFields } from "../editor/store.ts";
import { usePicker } from "./picker-store.ts";

export type TaskFieldShortcut = "today" | "pickDate" | "clearDate" | "labels";

/**
 * Task property shortcuts (tasks.md → Due dates, Labels): ^T today, ^D pick a date, ^⇧D clear
 * it, ^L labels. Control on Apple platforms; Alt elsewhere, where Ctrl is Mod and Ctrl+D
 * already completes [assumption]. Matched on `code` so Option/Alt layouts don't change keys.
 */
export function taskFieldShortcut(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">,
  apple = isApplePlatform(),
): TaskFieldShortcut | null {
  const modifier = apple
    ? event.ctrlKey && !event.altKey && !event.metaKey
    : event.altKey && !event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  if (event.code === "KeyD") return event.shiftKey ? "clearDate" : "pickDate";
  if (event.shiftKey) return null;
  if (event.code === "KeyT") return "today";
  if (event.code === "KeyL") return "labels";
  return null;
}

/** Runs a shortcut on a task block. Returns true when the key was one. */
export function handleTaskFieldKey(
  event: KeyboardEvent,
  block: Block,
  scope: "row" | "details",
  ctx: { today: string; timeZone: string; setFields: (fields: Pick<BlockFields, "due">) => void },
): boolean {
  if (!block.task) return false;
  const shortcut = taskFieldShortcut(event);
  if (!shortcut) return false;
  event.preventDefault();
  const current = block.task.due;
  switch (shortcut) {
    case "today": {
      const due: TaskDue = {
        date: ctx.today,
        time: current?.time ?? null,
        tz: current?.tz ?? ctx.timeZone,
      };
      ctx.setFields({ due });
      break;
    }
    case "clearDate":
      ctx.setFields({ due: null });
      break;
    case "pickDate":
      usePicker.getState().setOpen({ blockId: block.id, scope, kind: "due" });
      break;
    case "labels":
      usePicker.getState().setOpen({ blockId: block.id, scope, kind: "labels" });
      break;
  }
  return true;
}
