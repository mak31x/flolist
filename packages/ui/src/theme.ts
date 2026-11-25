/**
 * Theme selection (settings-and-account.md → Themes). M0.3 ships System preference, Light and Dark;
 * the remaining token sets are added in M6.
 */

export const themes = [
  { id: "system", name: "System preference" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
] as const;

export type ThemePreference = (typeof themes)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

/** localStorage key for the cached preference (the source of truth is the user record, from M1.1). */
export const THEME_STORAGE_KEY = "flolist.theme";

const ids = new Set<string>(themes.map((t) => t.id));

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && ids.has(value);
}

const darkQuery = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(darkQuery).matches;
}

export function resolveTheme(
  pref: ThemePreference,
  prefersDark = systemPrefersDark(),
): ResolvedTheme {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

/** Reads the cached preference. Storage can throw (private mode, sandboxed webviews), so fall back to System. */
export function readStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Not persisted; the theme still applies for this session.
  }
}

export function applyTheme(
  pref: ThemePreference,
  root: HTMLElement = document.documentElement,
): ResolvedTheme {
  const resolved = resolveTheme(pref);
  root.dataset.theme = resolved;
  return resolved;
}

/** Re-applies "system" whenever the OS scheme changes. Returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const mql = matchMedia(darkQuery);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

/**
 * Inline script for index.html: applies the cached theme before first paint to avoid a flash.
 * Keep in sync with readStoredTheme/resolveTheme (theme.test.ts runs it).
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark")p=matchMedia("${darkQuery}").matches?"dark":"light";document.documentElement.dataset.theme=p}catch(e){document.documentElement.dataset.theme="light"}})();`;
