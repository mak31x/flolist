/** Shortcut display helpers. `Mod` = ⌘ on macOS (and iOS), Ctrl elsewhere. */

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const appleSymbols: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  enter: "↩",
  backspace: "⌫",
  escape: "Esc",
};

const otherNames: Record<string, string> = {
  mod: "Ctrl",
  cmd: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  enter: "Enter",
  backspace: "Backspace",
  escape: "Esc",
};

/**
 * Splits "Mod+Shift+N" into display keys: ["⌘", "⇧", "N"] on Apple, ["Ctrl", "Shift", "N"] elsewhere.
 */
export function shortcutKeys(shortcut: string, apple = isApplePlatform()): string[] {
  const names = apple ? appleSymbols : otherNames;
  return shortcut.split("+").map((part) => {
    const key = part.trim();
    const mapped = names[key.toLowerCase()];
    if (mapped) return mapped;
    return key.length === 1 ? key.toUpperCase() : key;
  });
}

/** "⌘⇧N" on Apple (no separators), "Ctrl+Shift+N" elsewhere. */
export function formatShortcut(shortcut: string, apple = isApplePlatform()): string {
  return shortcutKeys(shortcut, apple).join(apple ? "" : "+");
}
