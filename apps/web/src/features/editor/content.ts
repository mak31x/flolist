import { normalizeInline, type InlineNode, type Mark } from "@flolist/shared";
import type { JSONContent } from "@tiptap/core";

/**
 * Each block's Tiptap editor holds a one-paragraph document. Our `content.inline` is that
 * paragraph's children in Tiptap's own JSON, so the mapping is a wrapper, plus stripping the
 * attributes our schema doesn't keep (link target/rel/class).
 */

export function inlineToDoc(inline: readonly InlineNode[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(inline.length > 0
          ? {
              content: inline.map((node): JSONContent => {
                if (node.type === "hardBreak") return { type: "hardBreak" };
                return node.marks
                  ? { type: "text", text: node.text, marks: node.marks.map((m) => ({ ...m })) }
                  : { type: "text", text: node.text };
              }),
            }
          : {}),
      },
    ],
  };
}

/**
 * A link target the server accepts (http, https or mailto), or null. Bare domains get
 * `https://`, like autolinked text does.
 */
export function normalizeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (href === "" || href.length > 2048) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`;
  return `https://${href.replace(/^\/+/, "")}`;
}

function toMark(mark: JSONContent): Mark | null {
  switch (mark.type) {
    case "bold":
    case "italic":
    case "strike":
    case "code":
      return { type: mark.type };
    case "link": {
      const href = normalizeHref(mark.attrs?.href);
      return href ? { type: "link", attrs: { href } } : null;
    }
    default:
      return null;
  }
}

export function docToInline(doc: JSONContent): InlineNode[] {
  const children = doc.content?.[0]?.content ?? [];
  const nodes: InlineNode[] = [];
  for (const node of children) {
    if (node.type === "hardBreak") nodes.push({ type: "hardBreak" });
    else if (node.type === "text" && node.text) {
      const marks = (node.marks ?? []).map(toMark).filter((m): m is Mark => m !== null);
      nodes.push(
        marks.length > 0
          ? { type: "text", text: node.text, marks }
          : { type: "text", text: node.text },
      );
    }
  }
  return normalizeInline(nodes);
}

export const sameInline = (a: readonly InlineNode[], b: readonly InlineNode[]) =>
  JSON.stringify(normalizeInline(a)) === JSON.stringify(normalizeInline(b));
