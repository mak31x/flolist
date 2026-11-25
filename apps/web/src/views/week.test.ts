import { describe, expect, it } from "vitest";
import { currentWeek } from "./week.ts";

// Wednesday 25 November 2026, mid-afternoon.
const wed = new Date(2026, 10, 25, 15, 30);

describe("currentWeek", () => {
  it.each([
    [1, 23],
    [0, 22],
    [6, 21],
  ] as const)("a week starting on weekday %i begins on the %ith", (firstDay, date) => {
    const days = currentWeek(firstDay, wed);
    expect(days).toHaveLength(7);
    expect(days[0]?.getDay()).toBe(firstDay);
    expect(days[0]?.getDate()).toBe(date);
    expect(days.some((d) => d.toDateString() === wed.toDateString())).toBe(true);
  });

  it("starts today when today is the first day", () => {
    expect(currentWeek(3, wed)[0]?.toDateString()).toBe(wed.toDateString());
  });
});
