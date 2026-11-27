import { describe, expect, it } from "vitest";
import {
  formatDayLong,
  formatMonth,
  monthGrid,
  shiftMonth,
  weekdayColumns,
  weekdayInitial,
} from "./calendar.ts";

describe("calendar", () => {
  it("lays out whole weeks from the first day of the week", () => {
    const grid = monthGrid("2026-11", 1);
    expect(grid[0]?.[0]).toBe("2026-10-26");
    expect(grid.at(-1)?.at(-1)).toBe("2026-12-06");
    expect(grid).toHaveLength(6);
    expect(monthGrid("2026-11", 0)[0]?.[0]).toBe("2026-11-01");
    expect(monthGrid("2026-02", 0)).toHaveLength(4); // Feb 2026 starts on a Sunday
  });

  it("moves between months and years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", -13)).toBe("2025-10");
  });

  it("names months, days and weekday columns", () => {
    expect(formatMonth("2026-11")).toBe("November 2026");
    expect(formatDayLong("2026-11-28")).toMatch(/^Saturday,? 28 November 2026$/);
    expect(weekdayColumns(1).map(weekdayInitial).join("")).toBe("MTWTFSS");
  });
});
