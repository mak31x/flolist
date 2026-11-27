import { formatDue, PRIORITIES, taskDueSchema, type ActivityEvent } from "@flolist/shared";
import { z } from "zod";
import { t } from "../../i18n/index.ts";
import { priorityName } from "../properties/priority.ts";

const names = z.array(z.string()).catch([]);
const movedList = z.object({ title: z.string() }).catch({ title: "" });
const list = (items: readonly string[]) => items.map((n) => `“${n}”`).join(", ");

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
export const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** "Karan created this task" and friends (tasks.md → Activity log). */
export function activityText(event: ActivityEvent): string {
  const name = event.actor?.name || t("tasks.activity.someone");
  if (event.action === "title_changed") {
    return t("tasks.activity.title_changed", {
      name,
      title: typeof event.new === "string" ? event.new : "",
    });
  }
  switch (event.action) {
    case "due_changed": {
      const due = taskDueSchema.safeParse(event.new);
      if (!due.success) return t("tasks.activity.due_cleared", { name });
      return t("tasks.activity.due_set", {
        name,
        date: formatDue(due.data, due.data.date, { relative: false }),
      });
    }
    case "priority_changed": {
      const level = typeof event.new === "number" ? PRIORITIES[event.new] : undefined;
      if (!level || level === "none") return t("tasks.activity.priority_cleared", { name });
      return t("tasks.activity.priority_set", { name, priority: priorityName(level) });
    }
    case "labels_changed": {
      const before = names.parse(event.old);
      const after = names.parse(event.new);
      const added = after.filter((n) => !before.includes(n));
      const removed = before.filter((n) => !after.includes(n));
      if (added.length > 0 && removed.length > 0) {
        return t("tasks.activity.labels_changed", {
          name,
          added: list(added),
          removed: list(removed),
        });
      }
      if (removed.length > 0)
        return t("tasks.activity.labels_removed", { name, labels: list(removed) });
      return t("tasks.activity.labels_added", { name, labels: list(added) });
    }
    case "moved": {
      const from = movedList.parse(event.old);
      const to = movedList.parse(event.new);
      return t("tasks.activity.moved", {
        name,
        from: from.title || t("lists.untitled"),
        to: to.title || t("lists.untitled"),
      });
    }
    default:
      return t(`tasks.activity.${event.action}`, { name });
  }
}

/** Entries grouped by local day, each group under its date. */
export function groupByDay(events: readonly ActivityEvent[]) {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    const day = dayFormat.format(new Date(event.createdAt));
    const last = groups.at(-1);
    if (last?.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}
