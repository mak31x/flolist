import { describe, expect, it } from "vitest";
import { formatShortcut, shortcutKeys } from "./shortcuts.ts";

describe("shortcuts", () => {
  it("maps Mod to ⌘ on Apple and Ctrl elsewhere", () => {
    expect(shortcutKeys("Mod+Shift+n", true)).toEqual(["⌘", "⇧", "N"]);
    expect(shortcutKeys("Mod+Shift+n", false)).toEqual(["Ctrl", "Shift", "N"]);
  });

  it("formats compactly on Apple and with + elsewhere", () => {
    expect(formatShortcut("Ctrl+N", true)).toBe("⌃N");
    expect(formatShortcut("Mod+Enter", false)).toBe("Ctrl+Enter");
  });
});
