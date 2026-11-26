import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, updatedAt, version } from "./columns.ts";
import { lists } from "./lists.ts";
import { workspaces } from "./workspaces.ts";

/**
 * A task (data-model.md → Blocks and tasks, D-056). In a list it is shown by one `task` block
 * (`blocks.task_id`); subtasks are task blocks in the parent's body and keep the parent's home
 * list in `list_id`. `title_inline` is the Tiptap inline title (the block's content), `title` its
 * plain text. Dates, priority, assignee and source columns arrive with their phases.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null for Inbox-only tasks (M4.1). */
    rootListId: uuid("root_list_id").references(() => lists.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "cascade" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull().default(""),
    titleInline: jsonb("title_inline").$type<unknown[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    version: version(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => user.id, { onDelete: "set null" }),
    trashRootId: uuid("trash_root_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_root_list_id_idx").on(t.rootListId),
    index("tasks_list_id_idx").on(t.listId),
    index("tasks_parent_task_id_idx").on(t.parentTaskId),
    index("tasks_trash_root_id_idx").on(t.trashRootId),
    index("tasks_workspace_id_idx").on(t.workspaceId),
  ],
);

export const activityEntityTypes = ["task"] as const;

/** One activity-log entry (tasks.md → Activity log). Written in the mutation's transaction. */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rootListId: uuid("root_list_id").references(() => lists.id, { onDelete: "set null" }),
    entityType: text("entity_type", { enum: activityEntityTypes }).notNull(),
    entityId: uuid("entity_id").notNull(),
    actorId: uuid("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    field: text("field"),
    old: jsonb("old"),
    new: jsonb("new"),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("activity_events_workspace_id_idx").on(t.workspaceId),
  ],
);
