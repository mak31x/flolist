import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, updatedAt, version } from "./columns.ts";
import { files } from "./files.ts";
import { lists } from "./lists.ts";

/** Block types built so far; the API checks these equal `BLOCK_TYPES` in packages/shared. */
export const blockTypes = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bullet",
  "numbered",
  "quote",
  "divider",
  "image",
  "attachment",
  "sublist",
] as const;
export type BlockTypeColumn = (typeof blockTypes)[number];
export const blockContainerTypes = ["list", "task"] as const;
/** Deepest bullet/numbered indent (`MAX_INDENT` in packages/shared). */
export const blockMaxIndent = 4;

/**
 * A fractional-index key stored with the "C" collation, so `order by position` and the
 * container index both sort byte-wise (D-041) without a `collate` in every query.
 */
const positionText = customType<{ data: string }>({
  dataType: () => `text collate "C"`,
});

/**
 * One block of a list or task body (D-007, data-model.md → Blocks). `root_list_id` is the root
 * list whose access and `list:<rootId>` channel apply. Image/attachment blocks point at a file,
 * sublist blocks at their child list (one block per list); the task reference arrives in M3.1.
 * Soft-deleted rows keep `trash_root_id`.
 */
export const blocks = pgTable(
  "blocks",
  {
    id: id(),
    containerType: text("container_type", { enum: blockContainerTypes }).notNull(),
    containerId: uuid("container_id").notNull(),
    rootListId: uuid("root_list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    position: positionText("position").notNull(),
    type: text("type", { enum: blockTypes }).notNull(),
    indent: smallint("indent").notNull().default(0),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    sublistId: uuid("sublist_id")
      .unique()
      .references((): AnyPgColumn => lists.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    version: version(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => user.id, { onDelete: "set null" }),
    trashRootId: uuid("trash_root_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("blocks_container_type_check", sql`${t.containerType} in ('list', 'task')`),
    check(
      "blocks_type_check",
      sql.raw(`"type" in (${blockTypes.map((type) => `'${type}'`).join(", ")})`),
    ),
    check("blocks_indent_check", sql.raw(`"indent" between 0 and ${String(blockMaxIndent)}`)),
    index("blocks_container_position_idx")
      .on(t.containerType, t.containerId, t.position)
      .where(sql`${t.deletedAt} is null`),
    index("blocks_root_list_id_idx").on(t.rootListId),
    index("blocks_trash_root_id_idx").on(t.trashRootId),
    index("blocks_file_id_idx").on(t.fileId),
    check(
      "blocks_reference_check",
      sql`(${t.fileId} is null or ${t.type} in ('image', 'attachment')) and ((${t.sublistId} is not null) = (${t.type} = 'sublist'))`,
    ),
  ],
);
