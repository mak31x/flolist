import { describe, expect, it } from "vitest";
import {
  MAX_BLOCK_TEXT,
  blockBatchSchema,
  blockContentSchema,
  contentMatchesType,
  emptyContent,
  inlineText,
  normalizeInline,
  numberedLabels,
  resolveBlockShape,
  type BlockType,
} from "./blocks.ts";
import { changeEventSchema } from "./sync.ts";

const id = (n: number) => `0190a5d2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;

describe("block content", () => {
  it("accepts Tiptap inline JSON and strips unknown link attrs", () => {
    const parsed = blockContentSchema.parse({
      inline: [
        { type: "text", text: "hi ", marks: [{ type: "bold" }] },
        {
          type: "text",
          text: "link",
          marks: [{ type: "link", attrs: { href: "https://x.dev", target: "_blank" } }],
        },
        { type: "hardBreak" },
      ],
    });
    expect(parsed).toEqual({
      inline: [
        { type: "text", text: "hi ", marks: [{ type: "bold" }] },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.dev" } }] },
        { type: "hardBreak" },
      ],
    });
  });

  it("rejects javascript: links, empty text nodes and oversized blocks", () => {
    const link = (href: string) => ({
      inline: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }],
    });
    expect(blockContentSchema.safeParse(link("javascript:alert(1)")).success).toBe(false);
    expect(blockContentSchema.safeParse(link("mailto:a@b.c")).success).toBe(true);
    expect(blockContentSchema.safeParse({ inline: [{ type: "text", text: "" }] }).success).toBe(
      false,
    );
    const big = { inline: [{ type: "text", text: "x".repeat(MAX_BLOCK_TEXT + 1) }] };
    expect(blockContentSchema.safeParse(big).success).toBe(false);
  });

  it("matches content to type", () => {
    for (const type of ["paragraph", "heading2", "bullet", "divider"] as BlockType[]) {
      expect(contentMatchesType(type, emptyContent(type))).toBe(true);
    }
    expect(contentMatchesType("divider", { inline: [] })).toBe(false);
    expect(contentMatchesType("quote", { color: "red" })).toBe(false);
    expect(blockContentSchema.safeParse({ color: "pink" }).success).toBe(false);
  });
});

describe("normalizeInline", () => {
  it("merges equal marks regardless of order, drops empty text, keeps breaks", () => {
    expect(
      normalizeInline([
        { type: "text", text: "a", marks: [{ type: "italic" }, { type: "bold" }] },
        { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "text", text: "" },
        { type: "hardBreak" },
        { type: "text", text: "c", marks: [] },
      ]),
    ).toEqual([
      { type: "text", text: "ab", marks: [{ type: "bold" }, { type: "italic" }] },
      { type: "hardBreak" },
      { type: "text", text: "c" },
    ]);
  });

  it("keeps links with different hrefs apart", () => {
    const link = (href: string) => ({ type: "link" as const, attrs: { href } });
    const out = normalizeInline([
      { type: "text", text: "a", marks: [link("https://a.dev")] },
      { type: "text", text: "b", marks: [link("https://b.dev")] },
    ]);
    expect(out).toHaveLength(2);
    expect(inlineText(out)).toBe("ab");
  });
});

describe("numberedLabels", () => {
  const b = (n: number, type: BlockType, indent = 0) => ({ id: id(n), type, indent });

  it("numbers each contiguous run and restarts after other blocks", () => {
    const labels = numberedLabels([
      b(1, "numbered"),
      b(2, "numbered"),
      b(3, "paragraph"),
      b(4, "numbered"),
    ]);
    expect([...labels.values()]).toEqual([1, 2, 1]);
  });

  it("counts per indent level; deeper items don't break the parent run", () => {
    const labels = numberedLabels([
      b(1, "numbered"),
      b(2, "numbered", 1),
      b(3, "numbered", 1),
      b(4, "bullet", 1),
      b(5, "numbered", 1),
      b(6, "numbered"),
      b(7, "numbered", 1),
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      [id(1)]: 1,
      [id(2)]: 1,
      [id(3)]: 2,
      [id(5)]: 1,
      [id(6)]: 2,
      [id(7)]: 1,
    });
  });

  it("a bullet at the same level restarts numbering", () => {
    const labels = numberedLabels([b(1, "numbered"), b(2, "bullet"), b(3, "numbered")]);
    expect(labels.get(id(3))).toBe(1);
  });
});

describe("block batch", () => {
  const base = { clientMutationId: id(99) };

  it("accepts upsert, move and delete", () => {
    const parsed = blockBatchSchema.parse({
      ...base,
      ops: [
        { op: "upsert", id: id(1), type: "paragraph", position: "a0", content: { inline: [] } },
        { op: "move", id: id(2), position: "a1", indent: 1 },
        { op: "delete", id: id(3) },
      ],
    });
    expect(parsed.ops).toHaveLength(3);
  });

  it("rejects empty batches, duplicate ids, bad positions and deep indents", () => {
    expect(blockBatchSchema.safeParse({ ...base, ops: [] }).success).toBe(false);
    expect(
      blockBatchSchema.safeParse({
        ...base,
        ops: [
          { op: "delete", id: id(1) },
          { op: "move", id: id(1), position: "a0" },
        ],
      }).success,
    ).toBe(false);
    expect(
      blockBatchSchema.safeParse({ ...base, ops: [{ op: "move", id: id(1), position: "a-" }] })
        .success,
    ).toBe(false);
    expect(
      blockBatchSchema.safeParse({ ...base, ops: [{ op: "upsert", id: id(1), indent: 5 }] })
        .success,
    ).toBe(false);
  });
});

describe("block change events", () => {
  it("parses block upserts and deletes", () => {
    const data = {
      id: id(1),
      containerType: "list",
      containerId: id(2),
      rootListId: id(2),
      position: "a0",
      type: "heading1",
      indent: 0,
      content: { inline: [{ type: "text", text: "Title" }] },
      fileId: null,
      sublistId: null,
      taskId: null,
      task: null,
      createdBy: id(3),
      version: 1,
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
    };
    const upsert = {
      type: "change",
      op: "upsert",
      entity: "block",
      id: id(1),
      version: 1,
      clientMutationId: null,
      data,
    };
    expect(changeEventSchema.parse(upsert)).toEqual(upsert);
    const del = {
      type: "change",
      op: "delete",
      entity: "block",
      id: id(1),
      version: 2,
      clientMutationId: id(4),
    };
    expect(changeEventSchema.parse(del)).toEqual(del);
  });
});

describe("media and sublist block shapes", () => {
  it("gives each new type its empty content and keeps reference types fixed", () => {
    expect(emptyContent("image")).toEqual({ file: null, caption: "" });
    expect(emptyContent("sublist")).toEqual({});
    const image = { type: "image" as const, indent: 0, content: emptyContent("image") };
    expect(resolveBlockShape(image, { type: "paragraph" }).ok).toBe(false);
    const para = { type: "paragraph" as const, indent: 0, content: emptyContent("paragraph") };
    expect(resolveBlockShape(para, { type: "attachment" }).ok).toBe(false);
    expect(resolveBlockShape(null, { type: "sublist" })).toEqual({
      ok: true,
      shape: { type: "sublist", indent: 0, content: {} },
    });
  });

  it("only accepts content that fits the type", () => {
    expect(blockContentSchema.safeParse({ caption: "x", file: null }).success).toBe(true);
    expect(contentMatchesType("image", { inline: [] })).toBe(false);
    expect(contentMatchesType("sublist", { inline: [] })).toBe(false);
    expect(contentMatchesType("sublist", {})).toBe(true);
    // Extra keys are refused, so an empty sublist content can't swallow other shapes.
    expect(blockContentSchema.safeParse({ caption: "x", file: null, evil: 1 }).success).toBe(false);
  });
});
