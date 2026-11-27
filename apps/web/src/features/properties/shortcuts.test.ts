import { describe, expect, it } from "vitest";
import { taskFieldShortcut } from "./shortcuts.ts";

const key = (
  code: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "metaKey" | "shiftKey", boolean>> = {},
) => ({
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("taskFieldShortcut", () => {
  it("uses Control on Apple platforms", () => {
    expect(taskFieldShortcut(key("KeyT", { ctrlKey: true }), true)).toBe("today");
    expect(taskFieldShortcut(key("KeyD", { ctrlKey: true }), true)).toBe("pickDate");
    expect(taskFieldShortcut(key("KeyD", { ctrlKey: true, shiftKey: true }), true)).toBe(
      "clearDate",
    );
    expect(taskFieldShortcut(key("KeyL", { ctrlKey: true }), true)).toBe("labels");
    expect(taskFieldShortcut(key("KeyD", { metaKey: true }), true)).toBeNull(); // ⌘D completes
  });

  it("uses Alt elsewhere, leaving Ctrl (Mod) alone", () => {
    expect(taskFieldShortcut(key("KeyT", { altKey: true }), false)).toBe("today");
    expect(taskFieldShortcut(key("KeyD", { ctrlKey: true }), false)).toBeNull();
    expect(taskFieldShortcut(key("KeyL", { altKey: true, shiftKey: true }), false)).toBeNull();
  });
});
