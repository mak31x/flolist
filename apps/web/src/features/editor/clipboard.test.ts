import { textInline, type BlockDraft, type InlineNode } from "@flolist/shared";
import { describe, expect, it } from "vitest";
import { BLOCKS_MIME, htmlToBlocks, readBlocks, writeBlocks } from "./clipboard.ts";

/** jsdom has no DataTransfer; this is the part the clipboard code uses. */
class FakeTransfer {
  readonly data = new Map<string, string>();
  constructor(private readonly refuse: string[] = []) {}
  setData(type: string, value: string) {
    if (this.refuse.includes(type)) throw new Error("refused");
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
}
const transfer = (refuse?: string[]) => new FakeTransfer(refuse) as unknown as DataTransfer;

const p = (text: string): BlockDraft => ({
  type: "paragraph",
  indent: 0,
  content: { inline: textInline(text) },
});
const t = (text: string, ...marks: ("bold" | "italic" | "strike" | "code")[]): InlineNode =>
  marks.length > 0
    ? { type: "text", text, marks: marks.map((type) => ({ type })) }
    : { type: "text", text };

const doc: BlockDraft[] = [
  { type: "heading1", indent: 0, content: { inline: textInline("Title") } },
  { type: "bullet", indent: 1, content: { inline: [t("deep", "bold")] } },
  { type: "divider", indent: 0, content: { color: "purple" } },
  p("end"),
];

const body = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

describe("writeBlocks / readBlocks", () => {
  it("round-trips exactly through the internal format", () => {
    const data = transfer();
    writeBlocks(data, doc);
    expect(data.getData(BLOCKS_MIME)).toBeTruthy();
    expect(data.getData("text/plain")).toContain("# Title");
    expect(readBlocks(data)).toEqual(doc);
  });

  it("falls back to the JSON inside the HTML when custom types are dropped", () => {
    const data = transfer([BLOCKS_MIME]);
    writeBlocks(data, doc);
    expect(data.getData(BLOCKS_MIME)).toBe("");
    expect(readBlocks(data)).toEqual(doc);
  });

  it("reads plain text as Markdown", () => {
    const data = transfer();
    data.setData("text/plain", "## Shopping\n- [ ] milk\n- eggs");
    expect(readBlocks(data)).toEqual([
      { type: "heading2", indent: 0, content: { inline: textInline("Shopping") } },
      { type: "task", indent: 0, content: { inline: textInline("milk") }, completed: false },
      { type: "bullet", indent: 0, content: { inline: textInline("eggs") } },
    ]);
  });

  it("ignores tampered internal JSON and uses the other formats", () => {
    const data = transfer();
    data.setData(BLOCKS_MIME, JSON.stringify([{ type: "image", indent: 0, content: {} }]));
    data.setData("text/plain", "fallback");
    expect(readBlocks(data)).toEqual([p("fallback")]);
  });
});

describe("media and sublists on the clipboard", () => {
  const fileId = "0190a5d2-7c1e-7000-8000-000000000001";
  const image: BlockDraft = {
    type: "image",
    indent: 0,
    content: {
      caption: "",
      file: { name: "a.png", mime: "image/png", sizeBytes: 1, width: 1, height: 1 },
    },
    fileId,
  };

  it("keeps an image's file and turns a sublist into its title", () => {
    const data = transfer();
    writeBlocks(data, [image, { type: "sublist", indent: 0, content: {}, title: "Packing" }]);
    expect(readBlocks(data)).toEqual([image, p("Packing")]);
  });

  it("refuses media drafts without a file", () => {
    const data = transfer();
    data.setData(BLOCKS_MIME, JSON.stringify([{ ...image, fileId: undefined }]));
    data.setData("text/plain", "fallback");
    expect(readBlocks(data)).toEqual([p("fallback")]);
  });
});

describe("htmlToBlocks", () => {
  it("maps headings, lists with nesting, quotes, rules and code", () => {
    const html = `
      <h1>One</h1><h4>Deep heading</h4>
      <ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>
      <blockquote><p>q1</p><p>q2</p></blockquote>
      <hr>
      <pre><code>x = 1
y = 2</code></pre>`;
    expect(htmlToBlocks(body(html))).toEqual([
      { type: "heading1", indent: 0, content: { inline: textInline("One") } },
      { type: "heading3", indent: 0, content: { inline: textInline("Deep heading") } },
      { type: "bullet", indent: 0, content: { inline: textInline("a") } },
      { type: "bullet", indent: 1, content: { inline: textInline("b") } },
      { type: "numbered", indent: 2, content: { inline: textInline("c") } },
      { type: "bullet", indent: 0, content: { inline: textInline("d") } },
      { type: "quote", indent: 0, content: { inline: textInline("q1") } },
      { type: "quote", indent: 0, content: { inline: textInline("q2") } },
      { type: "divider", indent: 0, content: { color: "gray" } },
      {
        type: "paragraph",
        indent: 0,
        content: { inline: [t("x = 1", "code"), { type: "hardBreak" }, t("y = 2", "code")] },
      },
    ]);
  });

  it("keeps inline marks and safe links, drops unsafe ones and Google Docs' fake bold", () => {
    const html =
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p>' +
      '<span style="font-weight:700">bold</span> <em>it</em> <s>gone</s> ' +
      '<a href="https://flolist.dev">ok</a> <a href="javascript:alert(1)">bad</a><br>next' +
      "</p></b>";
    expect(htmlToBlocks(body(html))).toEqual([
      {
        type: "paragraph",
        indent: 0,
        content: {
          inline: [
            t("bold", "bold"),
            t(" "),
            t("it", "italic"),
            t(" "),
            t("gone", "strike"),
            t(" "),
            {
              type: "text",
              text: "ok",
              marks: [{ type: "link", attrs: { href: "https://flolist.dev" } }],
            },
            t(" bad"),
            { type: "hardBreak" },
            t("next"),
          ],
        },
      },
    ]);
  });

  it("drops checklist checkboxes and treats loose inline HTML as one paragraph", () => {
    expect(htmlToBlocks(body('<ul><li><input type="checkbox"> todo</li></ul>'))).toEqual([
      { type: "bullet", indent: 0, content: { inline: textInline("todo") } },
    ]);
    expect(htmlToBlocks(body("just <strong>some</strong> words"))).toEqual([
      {
        type: "paragraph",
        indent: 0,
        content: { inline: [t("just "), t("some", "bold"), t(" words")] },
      },
    ]);
  });
});
