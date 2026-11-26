import type { ActivityEvent } from "@flolist/shared";
import { t } from "../../i18n/index.ts";

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
  return t(`tasks.activity.${event.action}`, { name });
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
