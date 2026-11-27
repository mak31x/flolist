import { describe, expect, it } from "vitest";
import { localNow, zoneOffsetMinutes } from "./civil.ts";
import { formatDue, formatDueTime, isOverdue } from "./format.ts";

const today = "2026-11-27"; // a Friday

describe("formatDue", () => {
  it.each([
    [{ date: "2026-11-27", time: null }, "Today"],
    [{ date: "2026-11-28", time: "17:00" }, "Tomorrow 5:00 pm"],
    [{ date: "2026-11-30", time: null }, "Monday"],
    [{ date: "2026-12-03", time: "09:05" }, "Thursday 9:05 am"],
    [{ date: "2026-12-04", time: null }, "4 Dec"],
    [{ date: "2026-11-24", time: null }, "24 Nov"],
    [{ date: "2026-11-26", time: null }, "26 Nov"],
    [{ date: "2027-01-05", time: "00:00" }, "5 Jan 2027 12:00 am"],
  ] as const)("%j → %s", (due, label) => {
    expect(formatDue(due, today)).toBe(label);
  });

  it("writes the date itself when not relative", () => {
    expect(formatDue({ date: "2026-11-28", time: "17:00" }, today, { relative: false })).toBe(
      "28 Nov 5:00 pm",
    );
  });

  it("formats noon and midnight", () => {
    expect(formatDueTime("12:00")).toBe("12:00 pm");
    expect(formatDueTime("00:30")).toBe("12:30 am");
  });
});

describe("isOverdue", () => {
  const now = { date: today, time: "14:00" };
  it.each([
    [{ date: "2026-11-26", time: null }, true],
    [{ date: "2026-11-27", time: null }, false],
    [{ date: "2026-11-27", time: "13:59" }, true],
    [{ date: "2026-11-27", time: "14:00" }, false],
    [{ date: "2026-11-28", time: "00:00" }, false],
  ] as const)("%j → %s", (due, overdue) => {
    expect(isOverdue(due, now)).toBe(overdue);
  });
});

describe("zones", () => {
  it("reads the wall clock and offset of a zone", () => {
    const instant = new Date("2026-11-27T20:00:00Z");
    expect(localNow(instant, "Asia/Kolkata")).toEqual({ date: "2026-11-28", time: "01:30" });
    expect(zoneOffsetMinutes(instant, "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(instant, "America/New_York")).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
  });
});
