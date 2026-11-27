import type { Weekday } from "../me.ts";

/**
 * Calendar ("civil") date helpers. Dates are `YYYY-MM-DD` strings and times `HH:mm` strings in a
 * named IANA zone; arithmetic runs on UTC `Date`s so the host's own zone never leaks in.
 */

export interface LocalNow {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** `HH:mm` in the zone. */
  time: string;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneParts(instant: Date, timeZone: string) {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, fmt);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(fmt.formatToParts(instant).find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** The wall-clock date and time of `instant` in `timeZone`. */
export function localNow(instant: Date, timeZone: string): LocalNow {
  const p = zoneParts(instant, timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** The zone's offset from UTC at `instant`, in minutes (IST = 330). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60_000);
}

function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function fromUtc(dt: Date): string {
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function civilDate(year: number, month: number, day: number): string {
  return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(date: string, days: number): string {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

export function weekdayOf(date: string): Weekday {
  return toUtc(date).getUTCDay() as Weekday;
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function startOfWeek(date: string, weekStart: Weekday): string {
  return addDays(date, -((weekdayOf(date) - weekStart + 7) % 7));
}

export function endOfWeek(date: string, weekStart: Weekday): string {
  return addDays(startOfWeek(date, weekStart), 6);
}

export function endOfMonth(date: string): string {
  const dt = toUtc(date);
  return fromUtc(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}

export function startOfNextMonth(date: string): string {
  const dt = toUtc(date);
  return fromUtc(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)));
}

/** The first `weekday` on or after `date`. */
export function nextWeekdayOnOrAfter(date: string, weekday: Weekday): string {
  return addDays(date, (weekday - weekdayOf(date) + 7) % 7);
}
