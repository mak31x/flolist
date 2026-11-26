import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, updatedAt, version } from "./columns.ts";
import { blocks } from "./blocks.ts";
import { files } from "./files.ts";
import { workspaces } from "./workspaces.ts";

export const linkAccessLevels = ["none", "view", "edit"] as const;
export type LinkAccess = (typeof linkAccessLevels)[number];

/**
 * A list (data-model.md → Lists). Roots have `root_list_id = id`; sublists (M2.3) point at
 * their root so access and live-sync channels resolve through it. Soft-deleted rows keep
 * `trash_root_id` = the list the user deleted, so Trash (M6.1) restores them together.
 */
export const lists = pgTable(
  "lists",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rootListId: uuid("root_list_id")
      .notNull()
      .references((): AnyPgColumn => lists.id, { onDelete: "cascade" }),
    parentListId: uuid("parent_list_id").references((): AnyPgColumn => lists.id, {
      onDelete: "cascade",
    }),
    /** The `sublist` block that holds this list (sublists only). */
    parentBlockId: uuid("parent_block_id").references((): AnyPgColumn => blocks.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default(""),
    emoji: text("emoji"),
    coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "set null" }),
    coverBuiltin: text("cover_builtin"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    linkAccess: text("link_access", { enum: linkAccessLevels }).notNull().default("none"),
    shareToken: text("share_token").unique(),
    version: version(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => user.id, { onDelete: "set null" }),
    trashRootId: uuid("trash_root_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("lists_link_access_check", sql`${t.linkAccess} in ('none', 'view', 'edit')`),
    check("lists_root_check", sql`(${t.parentListId} is null) = (${t.rootListId} = ${t.id})`),
    index("lists_workspace_id_idx").on(t.workspaceId),
    index("lists_created_by_idx").on(t.createdBy),
    index("lists_root_list_id_idx").on(t.rootListId),
    index("lists_trash_root_id_idx").on(t.trashRootId),
  ],
);

export const listSorts = [
  "manual",
  "creator",
  "assignee",
  "alphabetical",
  "priority",
  "created",
  "due",
  "source",
  "label",
  "completed",
] as const;
export type ListSort = (typeof listSorts)[number];

/** Per-user view settings for one list (sort/filter arrive in M3), plus when it was last opened. */
export const listViewPrefs = pgTable(
  "list_view_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    sort: text("sort", { enum: listSorts }).notNull().default("manual"),
    hideCompleted: boolean("hide_completed").notNull().default(false),
    tasksOnly: boolean("tasks_only").notNull().default(false),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.listId] }),
    index("list_view_prefs_list_id_idx").on(t.listId),
  ],
);

/**
 * The user's own sidebar groups (lists-and-blocks.md → Sections). Exactly one per user is the
 * default "Favorites" section, which can't be deleted. `position` keys sort with `collate "C"`.
 */
export const sections = pgTable(
  "sections",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: text("position").notNull(),
    collapsed: boolean("collapsed").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sections_user_id_idx").on(t.userId),
    uniqueIndex("sections_default_unique")
      .on(t.userId)
      .where(sql`${t.isDefault}`),
  ],
);

/**
 * A starred list pinned into one of the user's sections. Deleting a section deletes its
 * entries (the lists stay in All lists). Entries of soft-deleted lists are kept so a restore
 * from Trash brings them back; reads filter them out.
 */
export const sidebarEntries = pgTable(
  "sidebar_entries",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.listId] }),
    index("sidebar_entries_section_id_idx").on(t.sectionId),
    index("sidebar_entries_list_id_idx").on(t.listId),
  ],
);
