import { isApplePlatform } from "@flolist/ui";

/** `Mod` = ⌘ on Apple platforms, Ctrl elsewhere (keyboard-shortcuts.md). */
export function isMod(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

/** Mod + `key` with no other modifiers. */
export function isModKey(event: KeyboardEvent, key: string, shift = false): boolean {
  return (
    isMod(event) && !event.altKey && event.shiftKey === shift && event.key.toLowerCase() === key
  );
}

/** Mod+Z → "undo", Mod+Shift+Z (or Ctrl+Y off Apple) → "redo". */
export function historyKey(event: KeyboardEvent): "undo" | "redo" | null {
  if (!isMod(event) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !isApplePlatform() && !event.shiftKey) return "redo";
  return null;
}
