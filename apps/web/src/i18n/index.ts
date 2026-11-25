/**
 * i18n scaffolding (settings-and-account.md → App language). English is the only catalog;
 * new strings go through `t()` so adding a language later is a catalog, not a rewrite.
 * Older screens still have inline English (Backlog).
 */
import { en } from "./en.ts";

export type MessageKey = keyof typeof en;

/** Supported app languages; "system" resolves to the closest one (always English for now). */
export const languages = [{ id: "en", name: "English" }] as const;

/** Looks up a message and fills `{name}` placeholders. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
