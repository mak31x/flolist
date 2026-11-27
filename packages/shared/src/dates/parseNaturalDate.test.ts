import { describe, expect, it } from "vitest";
import type { Weekday } from "../me.ts";
import { findNaturalDates, parseNaturalDate, removeNaturalDate } from "./parseNaturalDate.ts";

/** Friday 27 Nov 2026, 21:00 in Kolkata (15:30 UTC). */
const FRIDAY_EVENING = "2026-11-27T15:30:00Z";
/** Friday 27 Nov 2026, 09:00 in Kolkata. */
const FRIDAY_MORNING = "2026-11-27T03:30:00Z";

interface Fixture {
  input: string;
  now?: string;
  timeZone?: string;
  weekStart?: Weekday;
  dayFirst?: boolean;
  /** null = no date phrase. */
  expected: { text: string; date: string; time?: string; rrule?: string; title?: string } | null;
}

const fixtures: Fixture[] = [
  // The phase's "done when".
  {
    input: "pay rent tomorrow at 5pm",
    expected: { text: "tomorrow at 5pm", date: "2026-11-28", time: "17:00", title: "pay rent" },
  },
  { input: "today", expected: { text: "today", date: "2026-11-27" } },
  { input: "tomorrow", expected: { text: "tomorrow", date: "2026-11-28" } },
  // Weekdays: a bare weekday is the next one after today; "this" stays in this week.
  {
    input: "call mom thursday",
    expected: { text: "thursday", date: "2026-12-03", title: "call mom" },
  },
  { input: "meet on friday", expected: { text: "on friday", date: "2026-12-04", title: "meet" } },
  { input: "this friday", expected: { text: "this friday", date: "2026-11-27" } },
  { input: "this monday", expected: { text: "this monday", date: "2026-11-30" } },
  { input: "next friday", expected: { text: "next friday", date: "2026-12-04" } },
  { input: "next monday", expected: { text: "next monday", date: "2026-11-30" } },
  {
    input: "next sunday",
    weekStart: 0,
    expected: { text: "next sunday", date: "2026-11-29" },
  },
  // Weeks and months honour the first day of the week.
  { input: "next week", expected: { text: "next week", date: "2026-11-30" } },
  { input: "next week", weekStart: 0, expected: { text: "next week", date: "2026-11-29" } },
  { input: "next week", weekStart: 6, expected: { text: "next week", date: "2026-11-28" } },
  { input: "this week", expected: { text: "this week", date: "2026-11-29" } },
  { input: "this week", weekStart: 0, expected: { text: "this week", date: "2026-11-28" } },
  { input: "end of week", expected: { text: "end of week", date: "2026-11-29" } },
  {
    input: "finish deck by the end of the month",
    expected: { text: "by the end of the month", date: "2026-11-30", title: "finish deck" },
  },
  { input: "next month", expected: { text: "next month", date: "2026-12-01" } },
  { input: "this month", expected: { text: "this month", date: "2026-11-30" } },
  {
    input: "next week at 10am",
    expected: { text: "next week at 10am", date: "2026-11-30", time: "10:00" },
  },
  // Calendar dates.
  { input: "January 5th", expected: { text: "January 5th", date: "2027-01-05" } },
  { input: "Jan 2027", expected: { text: "Jan 2027", date: "2027-01-01" } },
  {
    input: "report dec 3 at 10:30",
    expected: { text: "dec 3 at 10:30", date: "2026-12-03", time: "10:30", title: "report" },
  },
  { input: "taxes due 2 dec", expected: { text: "due 2 dec", date: "2026-12-02", title: "taxes" } },
  { input: "3/12", expected: { text: "3/12", date: "2027-03-12" } },
  { input: "3/12", dayFirst: true, expected: { text: "3/12", date: "2026-12-03" } },
  // Times: today while it's still ahead, else tomorrow.
  { input: "at 5pm", expected: { text: "at 5pm", date: "2026-11-28", time: "17:00" } },
  {
    input: "at 5pm",
    now: FRIDAY_MORNING,
    expected: { text: "at 5pm", date: "2026-11-27", time: "17:00" },
  },
  {
    input: "17:00",
    now: FRIDAY_MORNING,
    expected: { text: "17:00", date: "2026-11-27", time: "17:00" },
  },
  {
    input: "at 5pm",
    timeZone: "America/New_York", // 10:30 EST
    expected: { text: "at 5pm", date: "2026-11-27", time: "17:00" },
  },
  // Repeats.
  { input: "daily", expected: { text: "daily", date: "2026-11-27", rrule: "FREQ=DAILY" } },
  {
    input: "water plants every day at 9am",
    expected: {
      text: "every day at 9am",
      date: "2026-11-28",
      time: "09:00",
      rrule: "FREQ=DAILY",
      title: "water plants",
    },
  },
  {
    input: "every week",
    expected: { text: "every week", date: "2026-11-27", rrule: "FREQ=WEEKLY" },
  },
  { input: "weekly", expected: { text: "weekly", date: "2026-11-27", rrule: "FREQ=WEEKLY" } },
  {
    input: "every monday",
    expected: { text: "every monday", date: "2026-11-30", rrule: "FREQ=WEEKLY;BYDAY=MO" },
  },
  {
    input: "gym every friday at 7am",
    expected: {
      text: "every friday at 7am",
      date: "2026-11-27",
      time: "07:00",
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      title: "gym",
    },
  },
  {
    input: "every 2 weeks",
    expected: { text: "every 2 weeks", date: "2026-11-27", rrule: "FREQ=WEEKLY;INTERVAL=2" },
  },
  {
    input: "every other month",
    expected: { text: "every other month", date: "2026-11-27", rrule: "FREQ=MONTHLY;INTERVAL=2" },
  },
  { input: "monthly", expected: { text: "monthly", date: "2026-11-27", rrule: "FREQ=MONTHLY" } },
  { input: "yearly", expected: { text: "yearly", date: "2026-11-27", rrule: "FREQ=YEARLY" } },
  {
    input: "every weekday",
    expected: {
      text: "every weekday",
      date: "2026-11-27",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    },
  },
  {
    input: "standup every weekday at 9",
    expected: {
      text: "every weekday at 9",
      date: "2026-11-30",
      time: "09:00",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      title: "standup",
    },
  },
  // Not supported (parity) and words that only look like dates.
  { input: "review every second wednesday of the month", expected: null },
  { input: "enjoy the sun", expected: null },
  { input: "march on", expected: null },
  { input: "sat down", expected: null },
  { input: "one day", expected: null },
  { input: "do it right now", expected: null },
  { input: "buy 5 apples", expected: null },
  { input: "since last friday", expected: null },
  { input: "this evening", expected: null },
  { input: "", expected: null },
];

describe("parseNaturalDate fixtures", () => {
  for (const f of fixtures) {
    const label = `${JSON.stringify(f.input)}${f.weekStart !== undefined ? ` (week starts ${f.weekStart})` : ""}${f.now === FRIDAY_MORNING ? " (morning)" : ""}${f.timeZone ? ` (${f.timeZone})` : ""}${f.dayFirst ? " (day first)" : ""}`;
    it(label, () => {
      const match = parseNaturalDate(f.input, {
        now: new Date(f.now ?? FRIDAY_EVENING),
        timeZone: f.timeZone ?? "Asia/Kolkata",
        weekStart: f.weekStart ?? 1,
        ...(f.dayFirst ? { dayFirst: true } : {}),
      });
      if (f.expected === null) {
        expect(match).toBeNull();
        return;
      }
      expect(match).toMatchObject({
        text: f.expected.text,
        date: f.expected.date,
        time: f.expected.time ?? null,
        rrule: f.expected.rrule ?? null,
      });
      expect(f.input.slice(match?.index, match?.end)).toBe(f.expected.text);
      if (f.expected.title !== undefined && match) {
        expect(removeNaturalDate(f.input, match)).toBe(f.expected.title);
      }
    });
  }
});

describe("findNaturalDates", () => {
  const opts = { now: new Date(FRIDAY_EVENING), timeZone: "Asia/Kolkata", weekStart: 1 as const };

  it("returns every phrase in order and parseNaturalDate takes the last", () => {
    const text = "call today and next friday";
    expect(findNaturalDates(text, opts).map((m) => m.text)).toEqual(["today", "next friday"]);
    expect(parseNaturalDate(text, opts)?.date).toBe("2026-12-04");
  });

  it("dates a range at its end", () => {
    expect(parseNaturalDate("offsite monday to wednesday", opts)).toMatchObject({
      text: "monday to wednesday",
      date: "2026-12-02",
    });
  });
});

describe("removeNaturalDate", () => {
  it("collapses the space around the phrase", () => {
    expect(removeNaturalDate("call mom on friday, then", { index: 9, end: 18 })).toBe(
      "call mom, then",
    );
    expect(removeNaturalDate("tomorrow pay rent", { index: 0, end: 8 })).toBe("pay rent");
    expect(removeNaturalDate("tomorrow", { index: 0, end: 8 })).toBe("");
  });
});
