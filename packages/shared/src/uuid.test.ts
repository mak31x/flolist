import { describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidv7 } from "./uuid.ts";

describe("uuidv7", () => {
  it("is a valid version 7 UUID", () => {
    const id = uuidv7();
    expect(z.uuid({ version: "v7" }).safeParse(id).success).toBe(true);
  });
  it("encodes the timestamp so ids sort by time", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(Number.parseInt(a.replaceAll("-", "").slice(0, 12), 16)).toBe(1_700_000_000_000);
  });
  it("is unique", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(0)));
    expect(ids.size).toBe(1000);
  });
});
