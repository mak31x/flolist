import type { Weekday } from "@flolist/shared";

/** The seven days of this week, starting on the user's first day of the week. */
export function currentWeek(firstDay: Weekday, now = new Date()): Date[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() - firstDay + 7) % 7));
  return Array.from(
    { length: 7 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}
