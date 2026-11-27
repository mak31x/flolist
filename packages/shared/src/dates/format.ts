import { daysBetween, type LocalNow } from "./civil.ts";

/** A due date as stored: `YYYY-MM-DD` plus an optional `HH:mm` in the task's zone. */
export interface DueParts {
  date: string;
  time: string | null;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `17:05` → `5:05 pm` (tasks.md → Due dates). */
export function formatDueTime(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * "Today", "Tomorrow", a weekday name within the next 6 days, else "24 Nov" (with the year when
 * it isn't the current one), plus the time when set: "Tomorrow 5:00 pm". `relative: false`
 * always writes the date ("28 Nov 5:00 pm"), for logs that are read later.
 */
export function formatDue(
  due: DueParts,
  today: string,
  { relative = true }: { relative?: boolean } = {},
): string {
  const diff = relative ? daysBetween(today, due.date) : Number.NaN;
  const [y = 0, m = 1, d = 1] = due.date.split("-").map(Number);
  let label: string;
  if (diff === 0) label = "Today";
  else if (diff === 1) label = "Tomorrow";
  else if (diff > 1 && diff <= 6)
    label = WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  else {
    label = `${d} ${MONTH_SHORT[m - 1] ?? ""}`;
    if (y !== Number(today.slice(0, 4))) label += ` ${y}`;
  }
  return due.time ? `${label} ${formatDueTime(due.time)}` : label;
}

/** Past its date, or today with a time that has passed. */
export function isOverdue(due: DueParts, now: LocalNow): boolean {
  if (due.date !== now.date) return due.date < now.date;
  return due.time !== null && due.time < now.time;
}
