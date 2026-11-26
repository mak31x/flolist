import {
  MAX_INDENT,
  isIndentable,
  normalizeInline,
  numberedLabels,
  sortMarks,
  type BlockContent,
  type BlockType,
  type InlineNode,
  type Mark,
} from "./blocks.ts";

/**
 * Block ⇄ Markdown/HTML for copy and paste (D-007: Markdown + HTML + internal JSON). Markdown is
 * CommonMark-flavoured with GFM strikethrough. Pasting HTML is parsed in the web app (it needs
 * a DOM); this module only writes HTML.
 */

/** A block without identity or position: what clipboard formats carry. */
export interface BlockDraft {
  type: BlockType;
  indent: number;
  content: BlockContent;
}

// Writing Markdown.

const INDENT = "    ";

function escapeText(text: string): string {
  return text.replace(/[\\`*_~[\]<>]/g, "\\$&");
}

/** Escapes what would otherwise start a block construct at the beginning of a line. */
function escapeLineStart(line: string): string {
  return line.replace(
    /^(\s*)(#{1,6}(?=\s|$)|>|[-+*](?=\s)|\d+(?=[.)]\s)|-{3,}\s*$)/,
    (_, ws, m) => {
      const s = String(m);
      if (/^\d/.test(s)) return `${String(ws)}${s}\\`;
      return `${String(ws)}\\${s}`;
    },
  );
}

function sameMark(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  return a.type !== "link" || (b.type === "link" && a.attrs.href === b.attrs.href);
}

function openMark(mark: Mark): string {
  switch (mark.type) {
    case "link":
      return "[";
    case "bold":
      return "**";
    case "italic":
      return "*";
    case "strike":
      return "~~";
    case "code":
      return "";
  }
}

function closeMark(mark: Mark): string {
  switch (mark.type) {
    case "link":
      return `](${mark.attrs.href.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`;
    case "bold":
      return "**";
    case "italic":
      return "*";
    case "strike":
      return "~~";
    case "code":
      return "";
  }
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Inline nodes → Markdown. Marks open and close only where they change (like
 * prosemirror-markdown), and whitespace is kept outside delimiters so CommonMark still
 * recognises them.
 */
export function inlineToMarkdown(nodes: readonly InlineNode[]): string {
  let out = "";
  let active: Mark[] = [];
  const closeTo = (keep: number) => {
    while (active.length > keep) out += closeMark(active.pop() as Mark);
  };
  for (const node of normalizeInline(nodes)) {
    if (node.type === "hardBreak") {
      closeTo(0);
      out += "\\\n";
      continue;
    }
    const marks = sortMarks(node.marks ?? []).filter((m) => m.type !== "code");
    const code = node.marks?.some((m) => m.type === "code") ?? false;
    let keep = 0;
    while (
      keep < active.length &&
      keep < marks.length &&
      sameMark(active[keep] as Mark, marks[keep] as Mark)
    )
      keep++;
    // Leading whitespace goes before any delimiter we're about to close or open.
    let text = node.text;
    const lead = /^\s*/.exec(text)?.[0] ?? "";
    const trail = text.length > lead.length ? (/\s*$/.exec(text)?.[0] ?? "") : "";
    text = text.slice(lead.length, text.length - trail.length);
    if (keep < active.length) {
      closeTo(keep);
    }
    out += lead;
    if (text === "") {
      out += trail;
      continue;
    }
    for (const mark of marks.slice(keep)) {
      out += openMark(mark);
      active.push(mark);
    }
    out += code ? codeSpan(text) : escapeText(text);
    // Trailing whitespace: close marks the next node won't carry before emitting it.
    if (trail !== "") {
      closeTo(0);
      out += trail;
    }
  }
  closeTo(0);
  active = [];
  return out;
}

/** Blocks → Markdown. List items sit on consecutive lines; everything else is a paragraph. */
export function blocksToMarkdown(blocks: readonly BlockDraft[]): string {
  const withIds = blocks.map((b, i) => ({ ...b, id: String(i) }));
  const numbers = numberedLabels(withIds);
  let out = "";
  let prevList = false;
  withIds.forEach((block, i) => {
    const list = isIndentable(block.type);
    if (i > 0) out += list && prevList ? "\n" : "\n\n";
    prevList = list;
    if (block.type === "divider") {
      out += "---";
      return;
    }
    const inline = "inline" in block.content ? block.content.inline : [];
    const text = inlineToMarkdown(inline);
    const lines = text.split("\n").map(escapeLineStart);
    const first = lines[0] ?? "";
    const rest = lines.slice(1);
    switch (block.type) {
      case "heading1":
      case "heading2":
      case "heading3": {
        // Headings can't hold hard breaks; they become spaces.
        const hashes = "#".repeat(Number(block.type.slice(-1)));
        out += `${hashes} ${lines.join("\n").replace(/\\\n/g, " ")}`.trimEnd();
        return;
      }
      case "quote":
        out += lines.map((l) => `> ${l}`.trimEnd()).join("\n");
        return;
      case "bullet":
      case "numbered": {
        const marker = block.type === "bullet" ? "- " : `${String(numbers.get(block.id) ?? 1)}. `;
        const pad = INDENT.repeat(block.indent);
        const cont = pad + " ".repeat(marker.length);
        out += `${pad}${marker}${first}`.trimEnd();
        for (const line of rest) out += `\n${cont}${line}`;
        return;
      }
      default:
        out += lines.join("\n");
    }
  });
  return out;
}

// Writing HTML.

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

const HTML_TAG: Record<Exclude<Mark["type"], "link">, string> = {
  bold: "strong",
  italic: "em",
  strike: "s",
  code: "code",
};

export function inlineToHtml(nodes: readonly InlineNode[]): string {
  return normalizeInline(nodes)
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      let html = escapeHtml(node.text);
      for (const mark of [...sortMarks(node.marks ?? [])].reverse()) {
        html =
          mark.type === "link"
            ? `<a href="${escapeHtml(mark.attrs.href)}">${html}</a>`
            : `<${HTML_TAG[mark.type]}>${html}</${HTML_TAG[mark.type]}>`;
      }
      return html;
    })
    .join("");
}

/** Blocks → HTML. Indented list items nest inside the previous item's list. */
export function blocksToHtml(blocks: readonly BlockDraft[]): string {
  let out = "";
  // Open lists, outermost first: tag and indent level.
  const lists: { tag: "ul" | "ol"; indent: number }[] = [];
  const closeLists = (toDepth: number) => {
    while (lists.length > toDepth) out += `</li></${(lists.pop() as { tag: string }).tag}>`;
  };
  for (const block of blocks) {
    const inline = "inline" in block.content ? inlineToHtml(block.content.inline) : "";
    if (!isIndentable(block.type)) {
      closeLists(0);
      if (block.type === "divider") out += "<hr>";
      else if (block.type === "quote") out += `<blockquote><p>${inline}</p></blockquote>`;
      else if (block.type === "paragraph") out += `<p>${inline}</p>`;
      else out += `<h${block.type.slice(-1)}>${inline}</h${block.type.slice(-1)}>`;
      continue;
    }
    const tag = block.type === "bullet" ? "ul" : "ol";
    // Close lists deeper than this item, and a same-depth list of the other kind.
    while (lists.length > 0 && (lists.at(-1) as { indent: number }).indent > block.indent)
      closeLists(lists.length - 1);
    const top = lists.at(-1);
    if (top?.indent === block.indent && top.tag !== tag) closeLists(lists.length - 1);
    const current = lists.at(-1);
    if (current?.indent === block.indent) out += `</li><li>${inline}`;
    else {
      out += `<${tag}><li>${inline}`;
      lists.push({ tag, indent: block.indent });
    }
  }
  closeLists(0);
  return out;
}

// Reading Markdown.

const PUNCT_ESCAPABLE = /[!-/:-@[-`{-~]/;

interface Frame {
  marks: Mark[];
}

/** Markdown inline syntax → inline nodes (bold, italic, strike, code, links, hard breaks). */
export function markdownToInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const push = (text: string, marks: Mark[]) => {
    if (text !== "")
      nodes.push(
        marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text },
      );
  };
  parseInline(source, { marks: [] }, push, nodes);
  return normalizeInline(nodes);
}

function findClosing(src: string, from: number, delim: string): number {
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))?.[0] ?? "`";
      const end = src.indexOf(run, i + run.length);
      if (end !== -1) i = end + run.length - 1;
      continue;
    }
    if (src.startsWith(delim, i) && i > from && !/\s/.test(src[i - 1] ?? "")) {
      // `*` must not be the first half of `**` when looking for italics.
      if (delim === "*" && src[i + 1] === "*") {
        const inner = findClosing(src, i + 2, "**");
        if (inner !== -1) {
          i = inner + 1;
          continue;
        }
      }
      // In a longer run (`***`), a two-character closer is the run's last two characters.
      if (delim.length === 2) {
        let run = 0;
        while (src[i + run] === delim[0]) run++;
        return i + run - 2;
      }
      return i;
    }
  }
  return -1;
}

function parseInline(
  src: string,
  frame: Frame,
  push: (text: string, marks: Mark[]) => void,
  nodes: InlineNode[],
): void {
  let buf = "";
  const flush = () => {
    push(buf, frame.marks);
    buf = "";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    const next = src[i + 1];
    if (ch === "\\" && next === "\n") {
      flush();
      nodes.push({ type: "hardBreak" });
      i++;
      continue;
    }
    if (ch === "\\" && next !== undefined && PUNCT_ESCAPABLE.test(next)) {
      buf += next;
      i++;
      continue;
    }
    if (ch === "\n") {
      // Two trailing spaces mean a hard break; otherwise a soft break is a space.
      if (buf.endsWith("  ")) {
        buf = buf.replace(/ +$/, "");
        flush();
        nodes.push({ type: "hardBreak" });
      } else buf = `${buf.replace(/ +$/, "")} `;
      while (src[i + 1] === " ") i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))?.[0] ?? "`";
      const end = src.indexOf(run, i + run.length);
      if (end !== -1) {
        flush();
        let code = src.slice(i + run.length, end).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        push(code, [...frame.marks, { type: "code" }]);
        i = end + run.length - 1;
        continue;
      }
      buf += run;
      i += run.length - 1;
      continue;
    }
    if (ch === "[") {
      const link = matchLink(src, i);
      if (link) {
        flush();
        parseInline(
          link.text,
          { marks: [...frame.marks, { type: "link", attrs: { href: link.href } }] },
          push,
          nodes,
        );
        i = link.end - 1;
        continue;
      }
    }
    const delim = src.startsWith("**", i)
      ? "**"
      : src.startsWith("__", i)
        ? "__"
        : src.startsWith("~~", i)
          ? "~~"
          : ch === "*" || ch === "_"
            ? ch
            : null;
    if (delim && next !== undefined && !/\s/.test(src[i + delim.length] ?? " ")) {
      // `_` inside a word (snake_case) is literal.
      const wordBefore = delim.startsWith("_") && /[\p{L}\p{N}]/u.test(src[i - 1] ?? "");
      const end = wordBefore ? -1 : findClosing(src, i + delim.length, delim);
      const wordAfter =
        delim.startsWith("_") && end !== -1 && /[\p{L}\p{N}]/u.test(src[end + delim.length] ?? "");
      if (end !== -1 && !wordAfter) {
        flush();
        const type: Mark["type"] =
          delim === "~~" ? "strike" : delim.length === 2 ? "bold" : "italic";
        parseInline(
          src.slice(i + delim.length, end),
          { marks: [...frame.marks, { type }] },
          push,
          nodes,
        );
        i = end + delim.length - 1;
        continue;
      }
    }
    buf += ch;
  }
  flush();
}

function matchLink(src: string, start: number): { text: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1 || src[close + 1] !== "(") return null;
  const end = src.indexOf(")", close + 2);
  if (end === -1) return null;
  const raw =
    src
      .slice(close + 2, end)
      .trim()
      .replace(/^<(.*)>$/, "$1")
      .split(/\s+/)[0] ?? "";
  let href: string;
  try {
    href = decodeURI(raw);
  } catch {
    href = raw;
  }
  if (!/^(https?:|mailto:)/i.test(href)) return null;
  return { text: src.slice(start + 1, close), href, end: end + 1 };
}

const LIST_ITEM = /^(\s*)([-+*]|\d{1,9}[.)])(?:\s+(.*))?$/;
const TASK_MARKER = /^\[[ xX]\]\s+/;

function expandTabs(line: string): string {
  return line.replace(/^\t+/, (tabs) => INDENT.repeat(tabs.length));
}

function textDraft(type: BlockType, text: string, indent = 0): BlockDraft {
  return { type, indent, content: { inline: markdownToInline(text) } };
}

/**
 * Markdown → blocks. Handles ATX headings (H4–H6 become H3), lists (indent levels from a
 * stack of leading widths, so 2- and 4-space nesting both work), block quotes, thematic
 * breaks, fenced code (kept as code-marked paragraphs) and paragraphs. Checklist markers
 * (`- [ ]`) are dropped until tasks exist (M3.1) `[assumption]`.
 */
export function markdownToBlocks(markdown: string): BlockDraft[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n").map(expandTabs);
  const blocks: BlockDraft[] = [];
  let para: string[] = [];
  let quote: string[] | null = null;
  let listStack: number[] = [];
  let lastListItem: { lines: string[]; draft: BlockDraft } | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push(textDraft("paragraph", para.join("\n")));
    para = [];
  };
  const flushQuote = () => {
    if (quote) {
      // Each quoted paragraph (split by a bare `>`) becomes its own quote block.
      for (const chunk of quote.join("\n").split(/\n\s*\n/)) {
        if (chunk.trim() !== "") blocks.push(textDraft("quote", chunk));
      }
    }
    quote = null;
  };
  const flushListItem = () => {
    if (lastListItem) {
      lastListItem.draft.content = { inline: markdownToInline(lastListItem.lines.join("\n")) };
      lastListItem = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushListItem();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flushAll();
      listStack = [];
      const marker = fence[1] as string;
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] as string).trim().startsWith(marker); i++)
        code.push(lines[i] as string);
      const inline: InlineNode[] = [];
      code.forEach((l, j) => {
        if (j > 0) inline.push({ type: "hardBreak" });
        if (l !== "") inline.push({ type: "text", text: l, marks: [{ type: "code" }] });
      });
      blocks.push({ type: "paragraph", indent: 0, content: { inline: normalizeInline(inline) } });
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      listStack = [];
      blocks.push({ type: "divider", indent: 0, content: { color: "gray" } });
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      flushAll();
      listStack = [];
      const level = Math.min(3, (heading[1] as string).length);
      blocks.push(textDraft(`heading${String(level)}` as BlockType, heading[2] ?? ""));
      continue;
    }

    const quoted = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quoted) {
      flushPara();
      flushListItem();
      listStack = [];
      quote ??= [];
      quote.push(quoted[1] ?? "");
      continue;
    }
    if (quote) {
      // A lazy continuation line belongs to the quote.
      quote.push(trimmed);
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushPara();
      flushListItem();
      const width = (item[1] as string).length;
      while (listStack.length > 0 && width < (listStack.at(-1) as number)) listStack.pop();
      if (listStack.length === 0 || width > (listStack.at(-1) as number)) listStack.push(width);
      const indent = Math.min(MAX_INDENT, listStack.length - 1);
      const type: BlockType = /\d/.test(item[2] as string) ? "numbered" : "bullet";
      const text = (item[3] ?? "").replace(TASK_MARKER, "");
      const draft: BlockDraft = { type, indent, content: { inline: [] } };
      blocks.push(draft);
      lastListItem = { lines: [text], draft };
      continue;
    }

    if (lastListItem && /^\s+/.test(line)) {
      lastListItem.lines.push(trimmed);
      continue;
    }

    flushListItem();
    listStack = [];
    para.push(line.replace(/^\s+/, ""));
  }
  flushAll();
  return blocks;
}
