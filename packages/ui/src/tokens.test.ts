import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { motionCssVars } from "./motion.ts";

const css = readFileSync(join(import.meta.dirname, "themes.css"), "utf8");
const tailwind = readFileSync(join(import.meta.dirname, "tailwind.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("\n}", open));
}

function varNames(body: string): string[] {
  return [...body.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1] ?? "").sort();
}

describe("theme tokens", () => {
  const light = varNames(block('[data-theme="light"]'));
  const dark = varNames(block('[data-theme="dark"]'));

  it("defines the ui-design §3 tokens", () => {
    for (const t of [
      "--canvas",
      "--surface",
      "--surface-raised",
      "--text",
      "--text-muted",
      "--border",
      "--accent",
      "--accent-soft",
      "--info",
      "--success",
      "--chip",
    ]) {
      expect(light).toContain(t);
    }
  });

  it("Dark defines exactly the same tokens as Light", () => {
    expect(dark).toEqual(light);
  });

  it("maps every colour token into Tailwind", () => {
    const colours = light.filter((t) => !t.startsWith("--shadow"));
    for (const t of colours) expect(tailwind).toContain(`var(${t})`);
  });

  it("keeps the --motion-* CSS variables in sync with motion.ts", () => {
    const root = css.slice(css.indexOf("/* Motion"));
    for (const [name, value] of Object.entries(motionCssVars)) {
      expect(root).toContain(`${name}: ${value};`);
    }
  });
});
