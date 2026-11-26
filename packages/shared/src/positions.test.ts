import { describe, expect, it } from "vitest";
import {
  byPosition,
  compareKeys,
  isValidPosition,
  positionAfter,
  positionAt,
  positionBefore,
  positionBetween,
  positionSchema,
} from "./positions.ts";

describe("positions", () => {
  it("validates keys the library accepts", () => {
    expect(isValidPosition("a0")).toBe(true);
    expect(isValidPosition(positionBetween("a0", "a1"))).toBe(true);
    for (const bad of ["", "a", "a10", "!!", "a0".repeat(100), "a1 "]) {
      expect(isValidPosition(bad), bad).toBe(false);
    }
    expect(positionSchema.safeParse("a0").success).toBe(true);
    expect(positionSchema.safeParse("nope").success).toBe(false);
  });

  it("generates keys in order", () => {
    const first = positionAfter(null);
    const second = positionAfter(first);
    const between = positionBetween(first, second);
    const before = positionBefore(first);
    const sorted = [second, between, before, first].sort(compareKeys);
    expect(sorted).toEqual([before, first, between, second]);
  });

  it("recovers when two clients picked the same key", () => {
    const k = positionAfter(null);
    const next = positionBetween(k, k);
    expect(compareKeys(next, k)).toBe(1);
  });

  it("finds the key for a drop index", () => {
    const rows = ["a0", "a1", "a2"].map((position) => ({ position }));
    expect(compareKeys(positionAt(rows, 0), "a0")).toBe(-1);
    const mid = positionAt(rows, 1);
    expect(compareKeys(mid, "a0")).toBe(1);
    expect(compareKeys(mid, "a1")).toBe(-1);
    expect(compareKeys(positionAt(rows, 3), "a2")).toBe(1);
  });

  it("sorts by byte order, then id", () => {
    const rows = [
      { position: "a1", id: "b" },
      { position: "Zz", id: "x" },
      { position: "a1", id: "a" },
    ];
    expect(rows.sort(byPosition).map((r) => r.id)).toEqual(["x", "a", "b"]);
  });
});
