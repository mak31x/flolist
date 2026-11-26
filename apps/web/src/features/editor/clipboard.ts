import {
  MAX_INDENT,
  blockContentSchema,
  blockTypeSchema,
  blocksToHtml,
  contentMatchesType,
  isMediaBlockType,
  textInline,
  blocksToMarkdown,
  markdownToBlocks,
  normalizeInline,
  type BlockDraft,
  type BlockType,
  type InlineNode,
  type Mark,
} from "@flolist/shared";
import { z } from "zod";
import { normalizeHref } from "./content.ts";

/**
 * Copy and paste of whole blocks (D-007: Markdown + HTML + internal JSON). The JSON travels in
 * its own clipboard type and, because some webviews drop custom types, also inside the HTML as
 * a data attribute, so a copy inside Flolist round-trips exactly (divider colours included).
 */

export const BLOCKS_MIME = "application/x-flolist-blocks";
const HTML_ATTR = "data-flolist-blocks";

const draftsSchema = z.array(
  z
    .object({
      type: blockTypeSchema,
      indent: z.number().int().min(0).max(MAX_INDENT),
      content: blockContentSchema,
      fileId: z.uuid().optional(),
      title: z.string().max(500).optional(),
      completed: z.boolean().optional(),
    })
    .refine((d) => contentMatchesType(d.type, d.content))
    .refine((d) => !isMediaBlockType(d.type) || d.fileId !== undefined),
);

/**
 * What a paste can recreate: media blocks keep their file (the server checks it belongs to
 * this workspace); a sublist can't be cloned by a paste, so it comes back as its title.
 */
function pastable(drafts: BlockDraft[]): BlockDraft[] {
  return drafts.map((d) =>
    d.type === "sublist"
      ? { type: "paragraph", indent: 0, content: { inline: textInline(d.title ?? "") } }
      : d,
  );
}

export function writeBlocks(data: DataTransfer, drafts: readonly BlockDraft[]): void {
  const json = JSON.stringify(drafts);
  data.setData("text/plain", blocksToMarkdown(drafts));
  data.setData(
    "text/html",
    `<div ${HTML_ATTR}="${encodeURIComponent(json)}">${blocksToHtml(drafts)}</div>`,
  );
  try {
    data.setData(BLOCKS_MIME, json);
  } catch {
    // Some engines refuse custom types; the HTML copy carries the JSON too.
  }
}

function parseJson(raw: string): BlockDraft[] | null {
  try {
    const parsed = draftsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? pastable(parsed.data) : null;
  } catch {
    return null;
  }
}

/**
 * What a paste holds, as blocks: our own JSON, else HTML from other apps, else the plain text
 * read as Markdown (Markdown checklists become tasks).
 */
export function readBlocks(data: DataTransfer): BlockDraft[] {
  const custom = data.getData(BLOCKS_MIME);
  if (custom) {
    const drafts = parseJson(custom);
    if (drafts) return drafts;
  }
  const html = data.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tagged = doc.querySelector(`[${HTML_ATTR}]`)?.getAttribute(HTML_ATTR);
    if (tagged) {
      const drafts = parseJson(decodeURIComponent(tagged));
      if (drafts) return drafts;
    }
    const drafts = htmlToBlocks(doc.body);
    if (drafts.length > 0) return drafts;
  }
  return markdownToBlocks(data.getData("text/plain"));
}

// HTML → blocks.

function marksOf(el: Element, inherited: readonly Mark[]): Mark[] {
  const marks = [...inherited];
  const tag = el.tagName.toLowerCase();
  const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
  const weight = style?.fontWeight ?? "";
  // Google Docs wraps everything in <b style="font-weight:normal">.
  const bold = (tag === "b" || tag === "strong") && weight !== "normal" && weight !== "400";
  if (bold || weight === "bold" || Number(weight) >= 600) marks.push({ type: "bold" });
  if (tag === "em" || tag === "i" || style?.fontStyle === "italic") marks.push({ type: "italic" });
  if (
    tag === "s" ||
    tag === "del" ||
    tag === "strike" ||
    style?.textDecoration.includes("line-through")
  )
    marks.push({ type: "strike" });
  if (tag === "code" || tag === "kbd" || tag === "samp") marks.push({ type: "code" });
  if (tag === "a") {
    const href = normalizeHref(el.getAttribute("href"));
    if (href) marks.push({ type: "link", attrs: { href } });
  }
  return marks;
}

function inlineOf(node: Node, marks: readonly Mark[] = [], out: InlineNode[] = []): InlineNode[] {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ");
      if (text)
        out.push(
          marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text },
        );
    } else if (child instanceof Element) {
      if (child.tagName === "BR") out.push({ type: "hardBreak" });
      else inlineOf(child, marksOf(child, marks), out);
    }
  }
  return out;
}

/** Trims outer whitespace (HTML indentation) and merges runs. */
function tidy(nodes: InlineNode[]): InlineNode[] {
  const first = nodes[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = nodes.at(-1);
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return normalizeInline(nodes);
}

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "HR",
  "PRE",
  "TABLE",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "MAIN",
]);

const hasBlockChildren = (el: Element) => [...el.children].some((c) => BLOCK_TAGS.has(c.tagName));

export function htmlToBlocks(root: Element): BlockDraft[] {
  const out: BlockDraft[] = [];
  const text = (type: BlockType, nodes: InlineNode[], indent = 0) => {
    const inline = tidy(nodes);
    if (inline.length > 0 || type !== "paragraph")
      out.push({ type, indent: Math.min(indent, MAX_INDENT), content: { inline } });
  };

  const walk = (el: Element, listDepth: number) => {
    for (const child of el.children) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const level = Math.min(3, Number(tag[1]));
        text(`heading${String(level)}` as BlockType, inlineOf(child, marksOf(child, [])));
      } else if (tag === "HR") {
        out.push({ type: "divider", indent: 0, content: { color: "gray" } });
      } else if (tag === "UL" || tag === "OL") {
        for (const li of child.children) {
          if (li.tagName !== "LI") continue;
          // The item's own text (nested lists excluded), then its nested lists one level deeper.
          const own = li.cloneNode(true) as Element;
          for (const nested of own.querySelectorAll(":scope > ul, :scope > ol")) nested.remove();
          // Checklist checkboxes (<input>) carry no text, so they drop out here.
          const itemText = tidy(inlineOf(own));
          out.push({
            type: tag === "UL" ? "bullet" : "numbered",
            indent: Math.min(listDepth, MAX_INDENT),
            content: { inline: itemText },
          });
          for (const nested of li.querySelectorAll(":scope > ul, :scope > ol")) {
            const wrapper = document.createElement("div");
            wrapper.append(nested.cloneNode(true));
            walk(wrapper, listDepth + 1);
          }
        }
      } else if (tag === "BLOCKQUOTE") {
        if (hasBlockChildren(child)) {
          for (const p of child.children) text("quote", inlineOf(p, marksOf(p, [])));
        } else text("quote", inlineOf(child));
      } else if (tag === "PRE") {
        const lines = child.textContent.replace(/\n$/, "").split("\n");
        const inline: InlineNode[] = [];
        lines.forEach((line, i) => {
          if (i > 0) inline.push({ type: "hardBreak" });
          if (line) inline.push({ type: "text", text: line, marks: [{ type: "code" }] });
        });
        out.push({ type: "paragraph", indent: 0, content: { inline: normalizeInline(inline) } });
      } else if (tag === "SCRIPT" || tag === "STYLE" || tag === "META" || tag === "TITLE") {
        continue;
      } else if (hasBlockChildren(child)) {
        walk(child, listDepth);
      } else if (BLOCK_TAGS.has(tag) || tag === "SPAN" || tag === "B" || tag === "A") {
        text("paragraph", inlineOf(child, marksOf(child, [])));
      }
    }
  };

  // Loose inline content directly in <body> (e.g. a copied phrase) is one paragraph.
  if (!hasBlockChildren(root)) {
    const inline = tidy(inlineOf(root));
    return inline.length > 0 ? [{ type: "paragraph", indent: 0, content: { inline } }] : [];
  }
  walk(root, 0);
  return out;
}
