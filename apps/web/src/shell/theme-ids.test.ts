import { themePreferenceSchema } from "@flolist/shared";
import { themes } from "@flolist/ui/theme";
import { describe, expect, it } from "vitest";

describe("theme ids", () => {
  it("are the same in the UI and in the API schema", () => {
    expect(themes.map((t) => t.id)).toEqual(themePreferenceSchema.options);
  });
});
