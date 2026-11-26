import { describe, expect, it } from "vitest";
import type { InlineNode } from "./blocks.ts";
import {
  blocksToHtml,
  blocksToMarkdown,
  inlineToMarkdown,
  markdownToBlocks,
  markdownToInline,
  type BlockDraft,
} from "./markdown.ts";

const t = (text: string, ...marks: ("bold" | "italic" | "strike" | "code")[]): InlineNode =>
  marks.length > 0
    ? { type: "text", text, marks: marks.map((type) => ({ type })) }
    : { type: "text", text };
const link = (text: string, href: string): InlineNode => ({
  type: "text",
  text,
  marks: [{ type: "link", attrs: { href } }],
});
const draft = (type: BlockDraft["type"], inline: InlineNode[] = [], indent = 0): BlockDraft => ({
  type,
  indent,
  content: { inline },
});
const divider: BlockDraft = { type: "divider", indent: 0, content: { color: "gray" } };

describe("inline Markdown", () => {
  it("writes marks and reads them back", () => {
    const inline = [
      t("plain "),
      t("bold", "bold"),
      t(" "),
      t("italic", "italic"),
      t(" "),
      t("gone", "strike"),
      t(" "),
      t("x = `y`", "code"),
      t(" and "),
      link("a link", "https://example.com/a(b)"),
    ];
    const md = inlineToMarkdown(inline);
    expect(md).toBe(
      "plain **bold** *italic* ~~gone~~ `` x = `y` `` and [a link](https://example.com/a%28b%29)",
    );
    expect(markdownToInline(md)).toEqual(inline);
  });

  it("keeps whitespace outside delimiters and nests overlapping marks", () => {
    const inline = [t("bold ", "bold"), t("both", "bold", "italic"), t(" after")];
    const md = inlineToMarkdown(inline);
    expect(md).toBe("**bold** ***both*** after");
    // The space moved outside the bold delimiters, so it reads back as plain text.
    expect(markdownToInline(md)).toEqual([
      t("bold", "bold"),
      t(" "),
      t("both", "bold", "italic"),
      t(" after"),
    ]);
  });

  it("escapes Markdown characters in plain text", () => {
    const inline = [t("2 * 3 = _6_ [not a link] `tick` \\ <tag>")];
    const md = inlineToMarkdown(inline);
    expect(markdownToInline(md)).toEqual(inline);
  });

  it("round-trips hard breaks", () => {
    const inline: InlineNode[] = [t("one"), { type: "hardBreak" }, t("two", "bold")];
    expect(markdownToInline(inlineToMarkdown(inline))).toEqual(inline);
    expect(markdownToInline("a  \nb")).toEqual([t("a"), { type: "hardBreak" }, t("b")]);
    expect(markdownToInline("soft\nwrap")).toEqual([t("soft wrap")]);
  });

  it("reads __bold__ and _italic_ but not snake_case", () => {
    expect(markdownToInline("__b__ _i_ snake_case_name")).toEqual([
      t("b", "bold"),
      t(" "),
      t("i", "italic"),
      t(" snake_case_name"),
    ]);
  });

  it("leaves unmatched delimiters and unsafe links as text", () => {
    expect(markdownToInline("**open and *half")).toEqual([t("**open and *half")]);
    expect(markdownToInline("[x](javascript:alert(1))")).toEqual([t("[x](javascript:alert(1))")]);
  });
});

describe("blocks to Markdown", () => {
  it("writes every block type", () => {
    const md = blocksToMarkdown([
      draft("heading1", [t("Title")]),
      draft("paragraph", [t("Intro "), t("text", "bold")]),
      draft("bullet", [t("one")]),
      draft("bullet", [t("nested")], 1),
      draft("numbered", [t("first")]),
      draft("numbered", [t("second")]),
      draft("quote", [t("wise words")]),
      divider,
      draft("heading3", [t("End")]),
    ]);
    expect(md).toBe(
      [
        "# Title",
        "",
        "Intro **text**",
        "",
        "- one",
        "    - nested",
        "1. first",
        "2. second",
        "",
        "> wise words",
        "",
        "---",
        "",
        "### End",
      ].join("\n"),
    );
  });

  it("escapes paragraph text that looks like block syntax", () => {
    const blocks = [
      draft("paragraph", [t("# not a heading")]),
      draft("paragraph", [t("- not a bullet")]),
      draft("paragraph", [t("1. not numbered")]),
      draft("paragraph", [t("> not a quote")]),
      draft("paragraph", [t("---")]),
    ];
    expect(markdownToBlocks(blocksToMarkdown(blocks))).toEqual(blocks);
  });
});

describe("Markdown to blocks", () => {
  it("round-trips a structured document", () => {
    const blocks = [
      draft("heading1", [t("Plan")]),
      draft("paragraph", [
        t("Some "),
        t("context", "italic"),
        { type: "hardBreak" },
        t("on two lines"),
      ]),
      draft("heading2", [t("Steps")]),
      draft("numbered", [t("Draft")]),
      draft("numbered", [t("Detail")], 1),
      draft("numbered", [t("Ship")]),
      draft("bullet", [t("loose end")]),
      draft("quote", [t("Done is better than perfect")]),
      divider,
      draft("paragraph", [link("docs", "https://flolist.dev")]),
    ];
    expect(markdownToBlocks(blocksToMarkdown(blocks))).toEqual(blocks);
  });

  it("infers indent levels from 2- or 4-space nesting and tabs", () => {
    const levels = (md: string) => markdownToBlocks(md).map((b) => b.indent);
    expect(levels("- a\n  - b\n    - c\n  - d\n- e")).toEqual([0, 1, 2, 1, 0]);
    expect(levels("- a\n    - b\n        - c")).toEqual([0, 1, 2]);
    expect(levels("- a\n\t- b")).toEqual([0, 1]);
    expect(levels("- 0\n - 1\n  - 2\n   - 3\n    - 4\n     - 5")).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it("maps H4–H6 to H3, reads checklists as tasks and keeps fenced code", () => {
    const blocks = markdownToBlocks(
      "#### Deep\n\n- [ ] todo\n- [x] done\n\n```ts\nconst a = 1;\n\nend\n```",
    );
    expect(blocks).toEqual([
      draft("heading3", [t("Deep")]),
      { ...draft("task", [t("todo")]), completed: false },
      { ...draft("task", [t("done")]), completed: true },
      draft("paragraph", [
        t("const a = 1;", "code"),
        { type: "hardBreak" },
        { type: "hardBreak" },
        t("end", "code"),
      ]),
    ]);
  });

  it("joins wrapped paragraph and list lines, splits quote paragraphs", () => {
    expect(markdownToBlocks("one\ntwo\n\n- item\n  continued\n\n> a\n>\n> b")).toEqual([
      draft("paragraph", [t("one two")]),
      draft("bullet", [t("item continued")]),
      draft("quote", [t("a")]),
      draft("quote", [t("b")]),
    ]);
  });

  it("lets a list interrupt a paragraph and handles empty items and CRLF", () => {
    expect(markdownToBlocks("Shopping:\r\n- milk\r\n-\r\n* eggs")).toEqual([
      draft("paragraph", [t("Shopping:")]),
      draft("bullet", [t("milk")]),
      draft("bullet"),
      draft("bullet", [t("eggs")]),
    ]);
  });

  it("returns nothing for blank input", () => {
    expect(markdownToBlocks("\n  \n")).toEqual([]);
  });
});

describe("blocks to HTML", () => {
  it("writes semantic HTML with nested lists and escaped text", () => {
    const html = blocksToHtml([
      draft("heading2", [t("A & B")]),
      draft("bullet", [t("one")]),
      draft("bullet", [t("deep")], 1),
      draft("bullet", [t("two")]),
      draft("numbered", [t("n")]),
      draft("paragraph", [t("x", "bold", "italic"), link("<l>", "https://a.dev/?q=1&r=2")]),
      draft("quote", [t("q")]),
      divider,
    ]);
    expect(html).toBe(
      "<h2>A &#38; B</h2>" +
        "<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>" +
        "<ol><li>n</li></ol>" +
        '<p><strong><em>x</em></strong><a href="https://a.dev/?q=1&#38;r=2">&#60;l&#62;</a></p>' +
        "<blockquote><p>q</p></blockquote>" +
        "<hr>",
    );
  });
});

describe("media and sublist blocks", () => {
  const image: BlockDraft = {
    type: "image",
    indent: 0,
    content: {
      caption: "Beach",
      file: { name: "a.png", mime: "image/png", sizeBytes: 1, width: 1, height: 1 },
    },
    fileId: "0190a5d2-7c1e-7000-8000-000000000001",
  };
  const attachment: BlockDraft = {
    type: "attachment",
    indent: 0,
    content: {
      caption: "",
      file: { name: "notes.pdf", mime: "application/pdf", sizeBytes: 1, width: null, height: null },
    },
    fileId: "0190a5d2-7c1e-7000-8000-000000000002",
  };
  const sublist: BlockDraft = { type: "sublist", indent: 0, content: {}, title: "Packing" };

  it("writes Markdown links to the files and the sublist's title", () => {
    expect(blocksToMarkdown([image, attachment, sublist])).toBe(
      "![Beach](/api/v1/files/0190a5d2-7c1e-7000-8000-000000000001)\n\n" +
        "[notes.pdf](/api/v1/files/0190a5d2-7c1e-7000-8000-000000000002)\n\n" +
        "Packing",
    );
  });

  it("writes HTML images, links and paragraphs", () => {
    expect(blocksToHtml([image, attachment, sublist])).toBe(
      '<figure><img src="/api/v1/files/0190a5d2-7c1e-7000-8000-000000000001" alt="Beach"><figcaption>Beach</figcaption></figure>' +
        '<p><a href="/api/v1/files/0190a5d2-7c1e-7000-8000-000000000002">notes.pdf</a></p>' +
        "<p>Packing</p>",
    );
  });
});

describe("task blocks in Markdown and HTML", () => {
  it("write as checklist items", () => {
    const blocks = [
      { type: "task" as const, indent: 0, content: { inline: [t("open")] }, completed: false },
      { type: "task" as const, indent: 0, content: { inline: [t("done")] }, completed: true },
    ];
    expect(blocksToMarkdown(blocks)).toBe("- [ ] open\n- [x] done");
    expect(blocksToHtml(blocks)).toBe("<p>☐ open</p><p>☑ done</p>");
  });
});
