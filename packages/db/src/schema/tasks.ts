import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, positionText, updatedAt, version } from "./columns.ts";
import { lists } from "./lists.ts";
import { workspaces } from "./workspaces.ts";

/** Highest priority (`PRIORITIES` in packages/shared: none, low, medium, high). */
export const taskMaxPriority = 3;
/** Label colours (`LABEL_COLORS` in packages/shared); null = the default grey chip. */
export const labelColors = ["gray", "red", "orange", "green", "blue", "purple"] as const;

/**
 * A task (data-model.md → Blocks and tasks, D-056). In a list it is shown by one `task` block
 * (`blocks.task_id`); subtasks are task blocks in the parent's body and keep the parent's home
 * list in `list_id`. `title_inline` is the Tiptap inline title (the block's content), `title` its
 * plain text. The due date is a calendar date + optional wall-clock time in `due_tz` (CLAUDE.md
 * → Dates); priority 0 none · 1 low · 2 medium · 3 high. Recurrence, assignee and source columns
 * arrive with their phases.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null for Inbox-only tasks (M4.1): they live in no list and are reached through `inbox_items`. */
    rootListId: uuid("root_list_id").references(() => lists.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "cascade" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull().default(""),
    titleInline: jsonb("title_inline").$type<unknown[]>().notNull().default([]),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: time("due_time"),
    dueTz: text("due_tz"),
    priority: smallint("priority").notNull().default(0),
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
    check(
      "tasks_due_check",
      sql`(${t.dueDate} is null) = (${t.dueTz} is null) and (${t.dueTime} is null or ${t.dueDate} is not null)`,
    ),
    check("tasks_priority_check", sql.raw(`"priority" between 0 and ${String(taskMaxPriority)}`)),
  ],
);

/** Workspace-scoped labels (tasks.md → Labels), unique per workspace ignoring case. */
export const labels = pgTable(
  "labels",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color", { enum: labelColors }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("labels_workspace_name_idx").on(t.workspaceId, sql`lower(${t.name})`),
    check(
      "labels_color_check",
      sql.raw(`"color" is null or "color" in (${labelColors.map((c) => `'${c}'`).join(", ")})`),
    ),
  ],
);

/** A label on a task; chips show in the order they were added. */
export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_id_idx").on(t.labelId),
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

/** Why a task is in someone's Inbox (views.md → Inbox); `packages/shared` keeps the same list. */
export const inboxReasons = ["assigned", "manual", "quick", "integration"] as const;

/**
 * A task in a user's Inbox (views.md → Inbox, data-model.md). One row per user and task; it goes
 * when the task is completed, removed from the Inbox or moved onto a list. `position` is the
 * user's manual Inbox order (D-041).
 */
export const inboxItems = pgTable(
  "inbox_items",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    position: positionText("position").notNull(),
    reason: text("reason", { enum: inboxReasons }).notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    /** Its change events use this in ms as their version (like `list_view_prefs`, D-055). */
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.taskId] }),
    index("inbox_items_user_position_idx").on(t.userId, t.position),
    index("inbox_items_task_id_idx").on(t.taskId),
    check(
      "inbox_items_reason_check",
      sql.raw(`"reason" in (${inboxReasons.map((r) => `'${r}'`).join(", ")})`),
    ),
  ],
);

/**
 * A user's manual order of a task in Today for one calendar day (views.md → Today
 * `[assumption]`). Tasks without a row follow the view's sort after the ordered ones.
 */
export const todayOrder = pgTable(
  "today_order",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    position: positionText("position").notNull(),
    /** Its change events use this in ms as their version. */
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.date, t.taskId] }),
    index("today_order_task_id_idx").on(t.taskId),
  ],
);
