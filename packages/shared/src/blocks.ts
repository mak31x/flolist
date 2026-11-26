import { z } from "zod";
import { positionSchema } from "./positions.ts";
import { clientMutationSchema } from "./lists.ts";

/**
 * Blocks (D-007, lists-and-blocks.md → Block types). A container (a list now, a task body from
 * M3.1) holds an ordered list of typed blocks. Text blocks store Tiptap's inline JSON, so the
 * editor can load and save it without conversion.
 */

/**
 * Blocks with inline text (each mounts an inline editor). A `task` block is one of them: its
 * content is the task's title, and it also points at a `tasks` row (`taskId`, D-056).
 */
export const TEXT_BLOCK_TYPES = [
  "task",
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bullet",
  "numbered",
  "quote",
] as const;
/** Blocks that point at a file (`file_id`). */
export const MEDIA_BLOCK_TYPES = ["image", "attachment"] as const;
export const BLOCK_TYPES = [
  ...TEXT_BLOCK_TYPES,
  "divider",
  ...MEDIA_BLOCK_TYPES,
  "sublist",
] as const;

export const textBlockTypeSchema = z.enum(TEXT_BLOCK_TYPES);
export type TextBlockType = z.infer<typeof textBlockTypeSchema>;
export const blockTypeSchema = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof blockTypeSchema>;

export function isTextBlockType(type: BlockType): type is TextBlockType {
  return (TEXT_BLOCK_TYPES as readonly string[]).includes(type);
}

export type MediaBlockType = (typeof MEDIA_BLOCK_TYPES)[number];
export function isMediaBlockType(type: BlockType): type is MediaBlockType {
  return type === "image" || type === "attachment";
}

export function isTaskBlockType(type: BlockType): type is "task" {
  return type === "task";
}

/**
 * Blocks that own a reference (a file or a child list). Their type is fixed: they can't be
 * turned into another type, and no other block can be turned into one.
 */
export function isReferenceBlockType(type: BlockType): boolean {
  return isMediaBlockType(type) || type === "sublist";
}

/** Types that take an indent level (Tab / Shift+Tab). */
export function isIndentable(type: BlockType): boolean {
  return type === "bullet" || type === "numbered";
}

/** Deepest indent level for bullets and numbered items `[assumption]`. */
export const MAX_INDENT = 4;
/** Characters of text per block; a long pasted document is split into many blocks anyway. */
export const MAX_BLOCK_TEXT = 20_000;
/** Operations per batch request. */
export const MAX_BATCH_OPS = 500;

// Inline content: Tiptap's JSON for the children of a paragraph-like node.

const hrefSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((href) => /^(https?:|mailto:)/i.test(href), { error: "Links must be http(s) or mailto" });

export const simpleMarkTypeSchema = z.enum(["bold", "italic", "strike", "code"]);
export type SimpleMarkType = z.infer<typeof simpleMarkTypeSchema>;

export const markSchema = z.union([
  z.object({ type: simpleMarkTypeSchema }),
  z.object({ type: z.literal("link"), attrs: z.object({ href: hrefSchema }) }),
]);
export type Mark = z.infer<typeof markSchema>;

export const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(markSchema).max(5).optional(),
});
export type TextNode = z.infer<typeof textNodeSchema>;

export const inlineNodeSchema = z.union([
  textNodeSchema,
  z.object({ type: z.literal("hardBreak") }),
]);
export type InlineNode = z.infer<typeof inlineNodeSchema>;

export const inlineContentSchema = z
  .array(inlineNodeSchema)
  .max(2000)
  .refine((nodes) => inlineLength(nodes) <= MAX_BLOCK_TEXT, {
    error: `A block holds at most ${String(MAX_BLOCK_TEXT)} characters`,
  });

/** Divider colours `[assumption: 6]`; the theme maps each to a token. */
export const DIVIDER_COLORS = ["gray", "red", "orange", "green", "blue", "purple"] as const;
export const dividerColorSchema = z.enum(DIVIDER_COLORS);
export type DividerColor = z.infer<typeof dividerColorSchema>;

export const MAX_CAPTION = 2000;

export const textContentSchema = z.strictObject({ inline: inlineContentSchema });
export type TextContent = z.infer<typeof textContentSchema>;
export const dividerContentSchema = z.strictObject({ color: dividerColorSchema });
export type DividerContent = z.infer<typeof dividerContentSchema>;

/**
 * What a media block shows about its file. The server copies it from the `files` row whenever
 * the block's file is set, so clients can render without a second request.
 */
export const blockFileMetaSchema = z.strictObject({
  name: z.string().max(255),
  mime: z.string().max(255),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type BlockFileMeta = z.infer<typeof blockFileMetaSchema>;

/** Image and attachment blocks; `caption` is shown for images only. */
export const mediaContentSchema = z.strictObject({
  file: blockFileMetaSchema.nullable(),
  caption: z.string().max(MAX_CAPTION),
});
export type MediaContent = z.infer<typeof mediaContentSchema>;

/** Sublist blocks keep nothing of their own: the title lives on the child list. */
export const sublistContentSchema = z.strictObject({});
export type SublistContent = z.infer<typeof sublistContentSchema>;

export const blockContentSchema = z.union([
  textContentSchema,
  dividerContentSchema,
  mediaContentSchema,
  sublistContentSchema,
]);
export type BlockContent = z.infer<typeof blockContentSchema>;

/** The content every new block of a type starts with. */
export function emptyContent(type: BlockType): BlockContent {
  if (type === "divider") return { color: "gray" };
  if (isMediaBlockType(type)) return { file: null, caption: "" };
  if (type === "sublist") return {};
  return { inline: [] };
}

/** Does this content fit this type? */
export function contentMatchesType(type: BlockType, content: BlockContent): boolean {
  if (isTextBlockType(type)) return "inline" in content;
  if (type === "divider") return "color" in content;
  if (isMediaBlockType(type)) return "caption" in content;
  return Object.keys(content).length === 0;
}

export const containerTypeSchema = z.enum(["list", "task"]);
export type ContainerType = z.infer<typeof containerTypeSchema>;

/**
 * Where a block lives: a list, or a task's body (subtasks and the task's notes). A list page
 * loads its own blocks plus the bodies of its tasks, so subtasks can render nested.
 */
export const blockContainerSchema = z.strictObject({ type: containerTypeSchema, id: z.uuid() });
export type BlockContainer = z.infer<typeof blockContainerSchema>;

/** What a task block shows about its task, besides the title. */
export const blockTaskSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  completedBy: z.uuid().nullable(),
});
export type BlockTask = z.infer<typeof blockTaskSchema>;

export const blockSchema = z.object({
  id: z.uuid(),
  containerType: containerTypeSchema,
  containerId: z.uuid(),
  rootListId: z.uuid(),
  position: z.string(),
  type: blockTypeSchema,
  indent: z.number().int().min(0).max(MAX_INDENT),
  content: blockContentSchema,
  /** The file of an image/attachment block. */
  fileId: z.uuid().nullable(),
  /** The child list of a sublist block. */
  sublistId: z.uuid().nullable(),
  /** The task of a task block (its title is the block's content). */
  taskId: z.uuid().nullable(),
  /** Task blocks: the task's state, filled by the server from the `tasks` row. */
  task: blockTaskSchema.nullable(),
  createdBy: z.uuid().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Block = z.infer<typeof blockSchema>;

/** `GET /lists/:id/blocks`: the list's live blocks, sorted by position. */
export const blockPageSchema = z.object({ items: z.array(blockSchema) });
export type BlockPage = z.infer<typeof blockPageSchema>;

// Batch mutations (`POST /lists/:id/blocks/batch`). One request = one undoable editor command,
// applied atomically. Field-level last-write-wins (D-006): an upsert changes only what it sends.

const indentSchema = z.number().int().min(0).max(MAX_INDENT);

export const upsertBlockOpSchema = z.object({
  op: z.literal("upsert"),
  /** Client-generated UUIDv7 for a new block (D-006). */
  id: z.uuid(),
  /** Required when the block doesn't exist yet. */
  type: blockTypeSchema.optional(),
  position: positionSchema.optional(),
  indent: indentSchema.optional(),
  content: blockContentSchema.optional(),
  /**
   * Image/attachment blocks: a ready file in the list's workspace. Required on create, and may
   * be swapped later (e.g. replacing an image).
   */
  fileId: z.uuid().optional(),
  /**
   * Sublist blocks, on create only: the child list's client-made id and title. The server
   * creates the list with the block, in the same transaction.
   */
  sublist: z.object({ id: z.uuid(), title: z.string().max(500) }).optional(),
  /**
   * Task blocks. `id` is the client-made task id, required when the block becomes a task (on
   * create, or when a text block is turned into one); `completed` completes or reopens it.
   */
  task: z.object({ id: z.uuid().optional(), completed: z.boolean().optional() }).optional(),
  /**
   * The container: on create (default: the list itself), or a new one for an existing block.
   * It must be the list, or the body of a task that lives in it.
   */
  container: blockContainerSchema.optional(),
  /** The version the client last saw (accepted, not enforced yet; D-043). */
  baseVersion: z.number().int().positive().optional(),
});
export type UpsertBlockOp = z.infer<typeof upsertBlockOpSchema>;

export const moveBlockOpSchema = z.object({
  op: z.literal("move"),
  id: z.uuid(),
  position: positionSchema,
  /** A new indent level, for drags that change nesting. */
  indent: indentSchema.optional(),
  /** A new container in the same list: Tab / Shift+Tab on a task makes it a subtask or not. */
  container: blockContainerSchema.optional(),
});
export type MoveBlockOp = z.infer<typeof moveBlockOpSchema>;

export const deleteBlockOpSchema = z.object({ op: z.literal("delete"), id: z.uuid() });
export type DeleteBlockOp = z.infer<typeof deleteBlockOpSchema>;

export const blockOpSchema = z.discriminatedUnion("op", [
  upsertBlockOpSchema,
  moveBlockOpSchema,
  deleteBlockOpSchema,
]);
export type BlockOp = z.infer<typeof blockOpSchema>;

export const blockBatchSchema = clientMutationSchema.extend({
  ops: z
    .array(blockOpSchema)
    .min(1)
    .max(MAX_BATCH_OPS)
    .refine((ops) => new Set(ops.map((o) => o.id)).size === ops.length, {
      error: "Each block may appear once per batch",
    }),
});
export type BlockBatch = z.infer<typeof blockBatchSchema>;

/**
 * `POST /lists/:id/blocks/move-to`: moves blocks of this list into another list (a drop on a
 * sublist row or a sidebar list). They keep their order and land at the end of the target.
 */
export const moveBlocksToSchema = clientMutationSchema.extend({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(MAX_BATCH_OPS)
    .refine((ids) => new Set(ids).size === ids.length, { error: "Each block may appear once" }),
  targetListId: z.uuid(),
});
export type MoveBlocksTo = z.infer<typeof moveBlocksToSchema>;

/** The batch's effect: every changed block as it now is, and the ids that were deleted. */
export const blockBatchResultSchema = z.object({
  blocks: z.array(blockSchema),
  deleted: z.array(z.uuid()),
});
export type BlockBatchResult = z.infer<typeof blockBatchResultSchema>;

// Inline helpers shared by the editor, the serializers and the server.

export function inlineLength(nodes: readonly InlineNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.type === "text" ? node.text.length : 1;
  return n;
}

/** Plain text, with hard breaks as "\n". */
export function inlineText(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => (node.type === "text" ? node.text : "\n")).join("");
}

function markKey(mark: Mark): string {
  return mark.type === "link" ? `link:${mark.attrs.href}` : mark.type;
}

const MARK_ORDER: Record<Mark["type"], number> = {
  link: 0,
  bold: 1,
  italic: 2,
  strike: 3,
  code: 4,
};

/** Marks in a canonical order (link outermost, code innermost), without duplicates. */
export function sortMarks(marks: readonly Mark[]): Mark[] {
  const seen = new Map<Mark["type"], Mark>();
  for (const mark of marks) if (!seen.has(mark.type)) seen.set(mark.type, mark);
  return [...seen.values()].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type]);
}

export function sameMarks(a: readonly Mark[] = [], b: readonly Mark[] = []): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(markKey));
  return b.every((m) => keys.has(markKey(m)));
}

/** Drops empty text, merges neighbours with equal marks and sorts marks. */
export function normalizeInline(nodes: readonly InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (node.text === "") continue;
    const marks = sortMarks(node.marks ?? []);
    const last = out.at(-1);
    if (last?.type === "text" && sameMarks(last.marks, marks)) {
      last.text += node.text;
      continue;
    }
    out.push(
      marks.length > 0
        ? { type: "text", text: node.text, marks }
        : { type: "text", text: node.text },
    );
  }
  return out;
}

/** A plain-text run, for tests and simple content. */
export function textInline(text: string): InlineNode[] {
  return text === "" ? [] : [{ type: "text", text }];
}

/**
 * The number each `numbered` block shows: counted per contiguous run at its own indent level.
 * Deeper list items don't break a run above them; a shallower item, a bullet at the same level
 * or any other block type does.
 */
export function numberedLabels(
  blocks: readonly { id: string; type: BlockType; indent: number }[],
): Map<string, number> {
  const labels = new Map<string, number>();
  const counters: number[] = [];
  for (const block of blocks) {
    if (!isIndentable(block.type)) {
      counters.length = 0;
      continue;
    }
    counters.length = Math.min(counters.length, block.indent + 1);
    if (block.type === "numbered") {
      const next = (counters[block.indent] ?? 0) + 1;
      counters[block.indent] = next;
      labels.set(block.id, next);
    } else {
      counters[block.indent] = 0;
    }
  }
  return labels;
}

export interface BlockShape {
  type: BlockType;
  indent: number;
  content: BlockContent;
}

export type ShapeResult = { ok: true; shape: BlockShape } | { ok: false; error: string };

/**
 * The type, indent and content a block ends up with when `fields` are applied (the server and
 * the optimistic client use the same rule). Changing the type keeps the content when it still
 * fits (text → text) and resets it otherwise; types that can't indent are flattened to 0.
 */
export function resolveBlockShape(
  current: BlockShape | null,
  fields: {
    type?: BlockType | undefined;
    indent?: number | undefined;
    content?: BlockContent | undefined;
  },
): ShapeResult {
  const type = fields.type ?? current?.type;
  if (!type) return { ok: false, error: "A new block needs a type and a position" };
  if (
    current &&
    type !== current.type &&
    (isReferenceBlockType(type) || isReferenceBlockType(current.type))
  ) {
    return { ok: false, error: `A ${current.type} block can't become a ${type} block` };
  }
  let content = fields.content ?? current?.content ?? emptyContent(type);
  if (!contentMatchesType(type, content)) {
    if (fields.content) return { ok: false, error: `This content doesn't fit a ${type} block` };
    content = emptyContent(type);
  }
  const indent = isIndentable(type) ? (fields.indent ?? current?.indent ?? 0) : 0;
  return { ok: true, shape: { type, indent, content } };
}
