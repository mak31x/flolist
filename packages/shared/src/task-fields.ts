import { z } from "zod";
import { timeZoneSchema } from "./me.ts";

/**
 * Task property schemas shared by the task routes and the block batch (D-056: a task block's
 * upsert can set them too). Kept apart from tasks.ts so blocks.ts can import them without a
 * cycle.
 */

/** Priorities, stored as their index (data-model.md: 0 none · 1 low · 2 medium · 3 high). */
export const PRIORITIES = ["none", "low", "medium", "high"] as const;
export type PriorityName = (typeof PRIORITIES)[number];
export const prioritySchema = z
  .number()
  .int()
  .min(0)
  .max(PRIORITIES.length - 1);
export type Priority = z.infer<typeof prioritySchema>;

/** A calendar date, `YYYY-MM-DD`. */
export const isoDateSchema = z.iso.date();
/** A wall-clock time, `HH:mm` (24 h). */
export const dueTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

/**
 * A due date (CLAUDE.md → Dates): a calendar date, an optional time, and the IANA zone they're
 * read in. Without a time the task is due all day.
 */
export const taskDueSchema = z.object({
  date: isoDateSchema,
  time: dueTimeSchema.nullable(),
  tz: timeZoneSchema,
});
export type TaskDue = z.infer<typeof taskDueSchema>;

/** Setting a due date: `tz` defaults to the caller's profile time zone `[assumption]`. */
export const taskDueInputSchema = z.object({
  date: isoDateSchema,
  time: dueTimeSchema.nullable().optional(),
  tz: timeZoneSchema.optional(),
});
export type TaskDueInput = z.infer<typeof taskDueInputSchema>;

/** Labels on one task `[assumption]`. */
export const MAX_TASK_LABELS = 20;
/** The task's labels, in the order they were added; replaces the whole set when sent. */
export const taskLabelIdsSchema = z
  .array(z.uuid())
  .max(MAX_TASK_LABELS)
  .refine((ids) => new Set(ids).size === ids.length, { error: "Labels must be unique" });

/**
 * Task fields that both `PATCH /tasks/:id` and a block batch upsert (`task: {...}`) can change.
 * `due: null` clears the date.
 */
export const taskFieldsInputSchema = z.object({
  due: taskDueInputSchema.nullable().optional(),
  priority: prioritySchema.optional(),
  labelIds: taskLabelIdsSchema.optional(),
});
export type TaskFieldsInput = z.infer<typeof taskFieldsInputSchema>;
