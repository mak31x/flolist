import { addDays, endOfMonth, startOfWeek, weekdayOf, type Weekday } from "@flolist/shared";

/** `YYYY-MM` of a date. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The month `delta` months after `month` (`YYYY-MM`). */
export function shiftMonth(month: string, delta: number): string {
  const [y = 1970, m = 1] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Whole weeks covering `month`, starting on `weekStart`: each row is 7 `YYYY-MM-DD` dates. */
export function monthGrid(month: string, weekStart: Weekday): string[][] {
  const first = `${month}-01`;
  const last = endOfMonth(first);
  const weeks: string[][] = [];
  for (let day = startOfWeek(first, weekStart); day <= last; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

/** The weekdays in column order. */
export const weekdayColumns = (weekStart: Weekday): Weekday[] =>
  Array.from({ length: 7 }, (_, i) => ((weekStart + i) % 7) as Weekday);

export const isWeekend = (date: string) => {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
};

const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayLabel = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const weekdayShort = new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" });
const weekdayLong = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** "November 2026". */
export const formatMonth = (month: string) => monthLabel.format(utc(`${month}-01`));
/** "Saturday, 28 November 2026" (calendar buttons' accessible names). */
export const formatDayLong = (date: string) => dayLabel.format(utc(date));
/** A Sunday in January 2026 is the 4th; used to name weekday columns. */
export const weekdayInitial = (wd: Weekday) =>
  weekdayShort.format(utc(`2026-01-${String(4 + wd).padStart(2, "0")}`));
export const weekdayName = (wd: Weekday) =>
  weekdayLong.format(utc(`2026-01-${String(4 + wd).padStart(2, "0")}`));
