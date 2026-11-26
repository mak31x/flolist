import { z } from "zod";
import { inlineContentSchema, inlineText, type InlineNode } from "./blocks.ts";
import { clientMutationSchema } from "./lists.ts";

/**
 * Tasks (tasks.md → Task properties). In a list a task is a `task` block whose content is the
 * title; the `tasks` row holds everything else. Subtasks are task blocks in a task's body.
 * M3.1 has title, completion, subtasks and activity; dates, priority, labels, assignees and
 * sources arrive in their own phases.
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
  .refine((v) => v.titleInline !== undefined || v.completed !== undefined, {
    error: "Send at least one field to change",
  });
export type UpdateTask = z.infer<typeof updateTaskSchema>;

// Activity log (tasks.md → Activity log). M3.1 records these; the rest arrive with their fields.

export const ACTIVITY_ACTIONS = [
  "created",
  "title_changed",
  "completed",
  "reopened",
  "restored",
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
