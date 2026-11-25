import { describe, expect, it } from "vitest";
import { brand } from "./brand.ts";

describe("brand", () => {
  it("uses the Flolist wordmark", () => {
    expect(brand.wordmark).toBe("Flolist");
    expect(brand.monogram).toBe(brand.name[0]);
  });
});
