import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_STORAGE_KEY,
  themeBootScript,
} from "./theme.ts";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("resolves System preference from the OS scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("round-trips the cached preference and ignores junk", () => {
    expect(readStoredTheme()).toBe("system");
    storeTheme("dark");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readStoredTheme()).toBe("system");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoredTheme()).toBe("system");
    expect(() => {
      storeTheme("light");
    }).not.toThrow();
  });

  it("applies the resolved theme to <html>", () => {
    expect(applyTheme("dark")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("boot script sets data-theme before React runs", () => {
    // The inline script is a string by design (it goes into index.html), so run it the way the browser would.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const boot = new Function(themeBootScript) as () => void;
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    boot();
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    boot();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
