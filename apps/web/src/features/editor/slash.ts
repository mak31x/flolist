import type { BlockType } from "@flolist/shared";
import type { MessageKey } from "../../i18n/index.ts";

export interface SlashItem {
  type: BlockType;
  label: MessageKey;
  /** Extra words the filter matches. */
  aliases: readonly string[];
}

/**
 * The slash menu, in the order lists-and-blocks.md gives. Task, Sublist, Image and Attachment
 * join it with their phases (M3.1, M2.3); nothing is listed before it works.
 */
export const SLASH_ITEMS: readonly SlashItem[] = [
  { type: "paragraph", label: "editor.type.paragraph", aliases: ["text", "p"] },
  { type: "heading1", label: "editor.type.heading1", aliases: ["h1", "title"] },
  { type: "heading2", label: "editor.type.heading2", aliases: ["h2", "subtitle"] },
  { type: "heading3", label: "editor.type.heading3", aliases: ["h3"] },
  { type: "divider", label: "editor.type.divider", aliases: ["hr", "line", "separator", "---"] },
  { type: "bullet", label: "editor.type.bullet", aliases: ["ul", "unordered", "-"] },
  { type: "numbered", label: "editor.type.numbered", aliases: ["ol", "ordered", "1."] },
  { type: "quote", label: "editor.type.quote", aliases: ["quote", ">"] },
];

/** Items whose label or an alias contains the query (case-insensitive), labels first. */
export function filterSlashItems(query: string, label: (key: MessageKey) => string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...SLASH_ITEMS];
  const byLabel = SLASH_ITEMS.filter((item) => label(item.label).toLowerCase().includes(q));
  const byAlias = SLASH_ITEMS.filter(
    (item) => !byLabel.includes(item) && item.aliases.some((a) => a.includes(q)),
  );
  return [...byLabel, ...byAlias];
}

/** Markdown typed at the start of a paragraph, then a space (lists-and-blocks.md → Block types). */
export function markdownShortcut(prefix: string): BlockType | null {
  switch (prefix) {
    case "#":
      return "heading1";
    case "##":
      return "heading2";
    case "###":
      return "heading3";
    case "-":
    case "*":
      return "bullet";
    case ">":
      return "quote";
    default:
      return /^\d{1,9}[.)]$/.test(prefix) ? "numbered" : null;
  }
}
