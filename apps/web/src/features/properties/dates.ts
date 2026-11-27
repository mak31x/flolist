import {
  addDays,
  localNow,
  resolveWeekStart,
  startOfWeek,
  type LocalNow,
  type NaturalDateOptions,
  type TaskDue,
  type Weekday,
} from "@flolist/shared";
import { useEffect, useState } from "react";
import { systemFirstDay, systemLocale } from "../../platform/index.ts";
import { useMe } from "../auth/hooks.ts";

/** Whether the locale writes the day before the month (`3/12` = 3 December). */
export function dayFirstFor(locale: string): boolean {
  const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).formatToParts(
    new Date(2026, 11, 3),
  );
  const day = parts.findIndex((p) => p.type === "day");
  const month = parts.findIndex((p) => p.type === "month");
  return day !== -1 && month !== -1 && day < month;
}

export interface DateContext {
  /** The user's profile zone: due dates are read and set in it. */
  timeZone: string;
  weekStart: Weekday;
  /** Now in `timeZone`; refreshed every minute so "Today" and "overdue" roll over. */
  now: LocalNow;
  /** Options for `parseNaturalDate` at this instant. */
  nlOptions: () => NaturalDateOptions;
}

/** The user's zone, week start and the current local time. */
export function useDateContext(): DateContext {
  const me = useMe();
  const timeZone = me.timezone;
  const [instant, setInstant] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setInstant(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const now = localNow(new Date(instant), timeZone);
  const weekStart = resolveWeekStart(me.weekStart, systemFirstDay());
  return {
    timeZone,
    weekStart,
    now,
    nlOptions: () => ({
      now: new Date(),
      timeZone,
      weekStart,
      dayFirst: dayFirstFor(systemLocale()),
    }),
  };
}

/** The date picker's quick picks (ui-design §6). "Next week" is the first day of next week. */
export function quickPicks(ctx: Pick<DateContext, "now" | "weekStart">) {
  return {
    today: ctx.now.date,
    tomorrow: addDays(ctx.now.date, 1),
    nextWeek: addDays(startOfWeek(ctx.now.date, ctx.weekStart), 7),
  };
}

/** A due date on `date`, keeping the time of `current` (and its zone, else the user's). */
export function dueOn(date: string, current: TaskDue | null, timeZone: string): TaskDue {
  return { date, time: current?.time ?? null, tz: current?.tz ?? timeZone };
}
