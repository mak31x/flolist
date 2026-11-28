import { z } from "zod";
import { blockSchema, inlineContentSchema, inlineText, type InlineNode } from "./blocks.ts";
import { clientMutationSchema } from "./lists.ts";
import { prioritySchema, taskDueSchema, taskFieldsInputSchema } from "./task-fields.ts";

/**
 * Tasks (tasks.md → Task properties). In a list a task is a `task` block whose content is the
 * title; the `tasks` row holds everything else. Subtasks are task blocks in a task's body.
 * M3.1 added title, completion, subtasks and activity; M3.2 due dates, priority and labels.
 * Recurrence, reminders, assignees and sources arrive in their own phases.
 */

/** Characters in a task title `[assumption]`. */
export const MAX_TASK_TITLE = 2000;
/** How deep subtasks nest under a list task (a subtask of a subtask is depth 2) `[assumption]`. */
export const MAX_SUBTASK_DEPTH = 4;

export const taskTitleInlineSchema = inlineContentSchema.refine(
  (nodes) => inlineText(nodes).length <= MAX_TASK_TITLE,
  { error: `A task title holds at most ${String(MAX_TASK_TITLE)} characters` },
);

/** The plain title (search, sorts, activity): hard breaks become spaces, ends trimmed. */
export function taskTitleText(nodes: readonly InlineNode[]): string {
  return inlineText(nodes)
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** `GET /tasks/:id`: the task as the details panel shows it. */
export const taskSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** The home list (for subtasks, the list of the top-level task). */
  listId: z.uuid().nullable(),
  rootListId: z.uuid().nullable(),
  parentTaskId: z.uuid().nullable(),
  /** The block that shows the task in its list or parent task, if any. */
  blockId: z.uuid().nullable(),
  title: z.string(),
  titleInline: inlineContentSchema,
  completedAt: z.iso.datetime().nullable(),
  completedBy: z.uuid().nullable(),
  due: taskDueSchema.nullable(),
  priority: prioritySchema,
  labelIds: z.array(z.uuid()),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;

/** `PATCH /tasks/:id`: only the sent fields change (D-006). */
export const updateTaskSchema = clientMutationSchema
  .extend({
    titleInline: taskTitleInlineSchema.optional(),
    completed: z.boolean().optional(),
    baseVersion: z.number().int().positive().optional(),
  })
  .extend(taskFieldsInputSchema.shape)
  .refine(
    (v) => [v.titleInline, v.completed, v.due, v.priority, v.labelIds].some((f) => f !== undefined),
    { error: "Send at least one field to change" },
  );
export type UpdateTask = z.infer<typeof updateTaskSchema>;

/**
 * `GET /tasks/:id/page`: the body page of a task that lives in no list (Inbox-only, M4.1): the
 * live blocks of its body and of its subtasks' bodies. `taskId` is the page's top-level task
 * (asking for a subtask answers its top-level task's page). Tasks in a list use their list's
 * page (`GET /lists/:id/blocks`, D-056).
 */
export const taskPageSchema = z.object({ taskId: z.uuid(), items: z.array(blockSchema) });
export type TaskPage = z.infer<typeof taskPageSchema>;

/**
 * `POST /tasks/:id/move`: moves a task between a list and no list (M4.1). `listId: null` is
 * "Remove from list": the task (a subtask becomes top-level) leaves its list for the caller's
 * Inbox. A list id moves a top-level task in no list onto that list's end, out of the caller's
 * Inbox. Moves between lists use `POST /lists/:id/blocks/move-to`.
 */
export const moveTaskSchema = clientMutationSchema.extend({ listId: z.uuid().nullable() });
export type MoveTask = z.infer<typeof moveTaskSchema>;

/** `DELETE /tasks/:id` and `POST /tasks/:id/restore` (tasks in no list; list tasks use blocks). */
export const taskTrashSchema = clientMutationSchema;

// Activity log (tasks.md → Activity log). Each phase adds the actions of its fields. Old/new
// values: `due_changed` → TaskDue | null, `priority_changed` → Priority, `labels_changed` →
// label names (so the log still reads well after a label is renamed or deleted), `moved` →
// `{id, title}` of the old and new home list (titles as they were then).

export const ACTIVITY_ACTIONS = [
  "created",
  "title_changed",
  "completed",
  "reopened",
  "restored",
  "due_changed",
  "priority_changed",
  "labels_changed",
  "moved",
] as const;
export const activityActionSchema = z.enum(ACTIVITY_ACTIONS);
export type ActivityAction = z.infer<typeof activityActionSchema>;

/** Title edits by the same person this close together merge into one entry `[assumption]`. */
export const ACTIVITY_MERGE_MINUTES = 10;

export const activityActorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const activityEventSchema = z.object({
  id: z.uuid(),
  action: activityActionSchema,
  field: z.string().nullable(),
  old: z.unknown(),
  new: z.unknown(),
  /** Null once the account is gone. */
  actor: activityActorSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

/** `GET /tasks/:id/activity`: oldest first. */
export const activityPageSchema = z.object({ items: z.array(activityEventSchema) });
export type ActivityPage = z.infer<typeof activityPageSchema>;
