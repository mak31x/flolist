import * as chrono from "chrono-node";
import type { Weekday } from "../me.ts";
import {
  addDays,
  civilDate,
  endOfMonth,
  endOfWeek,
  localNow,
  nextWeekdayOnOrAfter,
  startOfNextMonth,
  startOfWeek,
  weekdayOf,
  zoneOffsetMinutes,
} from "./civil.ts";

/**
 * Natural-language due dates for task titles (tasks.md → Natural-language dates). chrono-node
 * does the general parsing; our own rules handle repeats and the week/month phrases that must
 * honour the first-day-of-week setting. Shared by the web app (suggestions) and the API.
 */

export interface NaturalDateOptions {
  /** The reference instant ("now"). */
  now: Date;
  /** IANA zone that "today" and times are read in. */
  timeZone: string;
  /** First day of the week (0 = Sunday), for "next week", "this friday", "end of week". */
  weekStart: Weekday;
  /** Read `3/12` as 3 December (D/M) instead of March 12 (M/D). */
  dayFirst?: boolean;
}

export interface NaturalDateMatch {
  /** Start of the consumed span in the input. */
  index: number;
  /** End of the consumed span (exclusive). */
  end: number;
  /** The consumed text, `input.slice(index, end)`. */
  text: string;
  /** Due date, `YYYY-MM-DD`. */
  date: string;
  /** Due time, `HH:mm`, or null for all-day. */
  time: string | null;
  /** RFC 5545 RRULE body (`FREQ=WEEKLY;BYDAY=MO`) for repeat phrases, else null. */
  rrule: string | null;
}

const WEEKDAYS: Record<string, Weekday> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WD = Object.keys(WEEKDAYS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const UNIT_FREQ = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" } as const;

interface Ctx {
  today: string;
  nowTime: string;
  weekStart: Weekday;
}

interface Partial {
  index: number;
  end: number;
  date: string;
  time: string | null;
  rrule: string | null;
  /** True when the date part is fixed by the phrase (not only a time). */
  hasDate: boolean;
}

type Rule = {
  re: RegExp;
  build: (
    m: RegExpExecArray,
    ctx: Ctx,
  ) => Omit<Partial, "index" | "end" | "time" | "hasDate"> | null;
};

const weekdayIn = (name: string | undefined) => WEEKDAYS[(name ?? "").toLowerCase()] ?? 0;

const rules: Rule[] = [
  // Repeats. Longest phrases first; "every second wednesday" matches none of them (not supported).
  {
    re: new RegExp(String.raw`\bevery\s+(?:week\s*day|work\s*day)\b`, "gi"),
    build: (_m, c) => ({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      date: nextWorkday(c.today),
    }),
  },
  {
    re: new RegExp(String.raw`\bevery\s+(?:other|(\d{1,3}))\s+(day|week|month|year)s?\b`, "gi"),
    build: (m) => {
      const interval = m[1] ? Number(m[1]) : 2;
      if (interval < 1) return null;
      const freq = UNIT_FREQ[(m[2] ?? "day").toLowerCase() as keyof typeof UNIT_FREQ];
      return {
        rrule: interval === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${interval}`,
        date: "",
      };
    },
  },
  {
    re: new RegExp(String.raw`\bevery\s+(${WD})\b`, "gi"),
    build: (m, c) => {
      const wd = weekdayIn(m[1]);
      return {
        rrule: `FREQ=WEEKLY;BYDAY=${RRULE_DAYS[wd]}`,
        date: nextWeekdayOnOrAfter(c.today, wd),
      };
    },
  },
  { re: /\b(?:daily|every\s*day)\b/gi, build: () => ({ rrule: "FREQ=DAILY", date: "" }) },
  { re: /\b(?:weekly|every\s+week)\b/gi, build: () => ({ rrule: "FREQ=WEEKLY", date: "" }) },
  { re: /\b(?:monthly|every\s+month)\b/gi, build: () => ({ rrule: "FREQ=MONTHLY", date: "" }) },
  {
    re: /\b(?:yearly|annually|every\s+year)\b/gi,
    build: () => ({ rrule: "FREQ=YEARLY", date: "" }),
  },
  // Week/month phrases (week start aware).
  {
    re: /\b(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?(week|month)\b/gi,
    build: (m, c) => ({
      rrule: null,
      date:
        (m[1] ?? "").toLowerCase() === "week"
          ? endOfWeek(c.today, c.weekStart)
          : endOfMonth(c.today),
    }),
  },
  {
    re: /\b(this|next)\s+(week|month)\b/gi,
    build: (m, c) => {
      const next = (m[1] ?? "").toLowerCase() === "next";
      if ((m[2] ?? "").toLowerCase() === "week") {
        return {
          rrule: null,
          date: next
            ? addDays(startOfWeek(c.today, c.weekStart), 7)
            : endOfWeek(c.today, c.weekStart),
        };
      }
      return { rrule: null, date: next ? startOfNextMonth(c.today) : endOfMonth(c.today) };
    },
  },
  {
    re: new RegExp(String.raw`\b(this|next)\s+(${WD})\b`, "gi"),
    build: (m, c) => {
      const wd = weekdayIn(m[2]);
      const weekStartDate = startOfWeek(c.today, c.weekStart);
      const offset = (wd - c.weekStart + 7) % 7;
      if ((m[1] ?? "").toLowerCase() === "next") {
        return { rrule: null, date: addDays(weekStartDate, 7 + offset) };
      }
      const inThisWeek = addDays(weekStartDate, offset);
      return { rrule: null, date: inThisWeek < c.today ? addDays(inThisWeek, 7) : inThisWeek };
    },
  },
];

function nextWorkday(date: string): string {
  const wd = weekdayOf(date);
  return wd === 6 ? addDays(date, 2) : wd === 0 ? addDays(date, 1) : date;
}

function runRules(text: string, ctx: Ctx): Partial[] {
  const found: Partial[] = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const index = m.index;
      const end = index + m[0].length;
      if (found.some((f) => f.index < end && index < f.end)) continue; // an earlier rule won
      const built = rule.build(m, ctx);
      if (!built) continue;
      found.push({
        ...built,
        date: built.date || ctx.today,
        index,
        end,
        time: null,
        hasDate: true,
      });
    }
  }
  return found;
}

const BARE_WEEKDAY_ABBR = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)$/i;
const PAST_WORDS = /\b(?:last|yesterday|ago|past|previous)\b/i;
const BARE_DURATION = /^(?:an?|one)\s+(?:day|week|month|year)s?$/i;
const ORDINAL_BEFORE = /\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+$/i;
const BARE_PERIOD = /^(?:the|this|that)\s+(?:day|week|month|year)$/i;

function runChrono(text: string, opts: NaturalDateOptions, ctx: Ctx): Partial[] {
  const parser = opts.dayFirst ? chrono.en.GB : chrono.casual;
  const results = parser.parse(
    text,
    { instant: opts.now, timezone: zoneOffsetMinutes(opts.now, opts.timeZone) },
    { forwardDate: true },
  );
  const out: Partial[] = [];
  for (const r of results) {
    // A range ("monday to friday") is due at its end.
    const s = r.end ?? r.start;
    const phrase = r.text.trim();
    const certain = (k: Parameters<typeof s.isCertain>[0]) => s.isCertain(k);
    const hasHour = certain("hour");
    const hasDate = certain("day") || certain("weekday") || certain("month") || certain("year");
    if (!hasHour && !hasDate) continue; // "this evening"
    if (/^(?:right\s+)?now$/i.test(phrase)) continue;
    if (
      PAST_WORDS.test(phrase) ||
      BARE_DURATION.test(phrase) ||
      BARE_PERIOD.test(phrase) ||
      BARE_WEEKDAY_ABBR.test(phrase)
    ) {
      continue;
    }
    // A month alone ("march on") is a word, not a date; "Jan 2027" and "may 5" are dates.
    if (certain("month") && !certain("day") && !certain("year")) continue;
    if (ORDINAL_BEFORE.test(text.slice(0, r.index))) continue; // "every second wednesday"
    const date = civilDate(s.get("year") ?? 1970, s.get("month") ?? 1, s.get("day") ?? 1);
    const time = hasHour
      ? `${String(s.get("hour") ?? 0).padStart(2, "0")}:${String(s.get("minute") ?? 0).padStart(2, "0")}`
      : null;
    out.push({
      index: r.index,
      end: r.index + r.text.length,
      date: date < ctx.today && !hasDate ? ctx.today : date,
      time,
      rrule: null,
      hasDate,
    });
  }
  return out;
}

const GAP = /^\s+(?:at\s+)?$/i;

/** Every date phrase in `text`, in order, without overlaps. */
export function findNaturalDates(text: string, opts: NaturalDateOptions): NaturalDateMatch[] {
  const now = localNow(opts.now, opts.timeZone);
  const ctx: Ctx = { today: now.date, nowTime: now.time, weekStart: opts.weekStart };
  const own = runRules(text, ctx);
  const fromChrono = runChrono(text, opts, ctx);

  // Our rules own the date; chrono may add the time when its phrase overlaps or sits right
  // next to ours ("next friday at 5pm", "daily at 9").
  const used = new Set<Partial>();
  for (const o of own) {
    for (const c of fromChrono) {
      if (used.has(c)) continue;
      const overlaps = c.index < o.end && o.index < c.end;
      const timeOnlyAfter = !c.hasDate && c.index >= o.end && GAP.test(text.slice(o.end, c.index));
      const timeOnlyBefore =
        !c.hasDate && c.end <= o.index && /^\s+$/.test(text.slice(c.end, o.index));
      if (!overlaps && !timeOnlyAfter && !timeOnlyBefore) continue;
      used.add(c);
      o.index = Math.min(o.index, c.index);
      o.end = Math.max(o.end, c.end);
      if (c.time) o.time = c.time;
    }
    // A daily or workday repeat whose time already passed today starts with the next one.
    if (o.time && o.date === ctx.today && o.time <= ctx.nowTime && o.rrule) {
      if (o.rrule === "FREQ=DAILY") o.date = addDays(o.date, 1);
      else if (o.rrule.endsWith("BYDAY=MO,TU,WE,TH,FR")) o.date = nextWorkday(addDays(o.date, 1));
    }
  }

  const all = [...own, ...fromChrono.filter((c) => !used.has(c))].sort(
    (a, b) => a.index - b.index || b.end - a.end,
  );
  const matches: NaturalDateMatch[] = [];
  for (const p of all) {
    const prev = matches.at(-1);
    if (prev && p.index < prev.end) continue; // overlapping leftovers: keep the earlier, longer one
    let index = p.index;
    const lead = /\b(?:due|by|on)\s+$/i.exec(text.slice(0, index));
    if (lead && (!prev || lead.index >= prev.end)) index = lead.index;
    matches.push({
      index,
      end: p.end,
      text: text.slice(index, p.end),
      date: p.date,
      time: p.time,
      rrule: p.rrule,
    });
  }
  return matches;
}

/** The last date phrase in `text` (the one typed most recently), or null. */
export function parseNaturalDate(text: string, opts: NaturalDateOptions): NaturalDateMatch | null {
  return findNaturalDates(text, opts).at(-1) ?? null;
}

/** `text` without the match's span, with the whitespace around it collapsed. */
export function removeNaturalDate(
  text: string,
  match: Pick<NaturalDateMatch, "index" | "end">,
): string {
  const before = text.slice(0, match.index).replace(/\s+$/, "");
  const after = text.slice(match.end).replace(/^\s+/, "");
  if (!before) return after;
  if (!after) return before;
  return /^[,.;:!?)]/.test(after) ? before + after : `${before} ${after}`;
}
