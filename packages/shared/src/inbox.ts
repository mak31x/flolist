import { z } from "zod";
import { clientMutationSchema } from "./lists.ts";
import { positionSchema } from "./positions.ts";
import { taskFieldsInputSchema } from "./task-fields.ts";
import { taskSchema, taskTitleInlineSchema } from "./tasks.ts";

/**
 * The Inbox (views.md → Inbox): a per-user, manually ordered set of tasks. A task is in it
 * through an `inbox_items` row; Inbox-only tasks live in no list at all (`listId` null).
 */

/** Why a task is in the Inbox; the DB keeps the same list (`inboxReasons`). */
export const INBOX_REASONS = ["assigned", "manual", "quick", "integration"] as const;
export const inboxReasonSchema = z.enum(INBOX_REASONS);
export type InboxReason = z.infer<typeof inboxReasonSchema>;

export const inboxItemSchema = z.object({
  taskId: z.uuid(),
  position: z.string(),
  reason: inboxReasonSchema,
  addedAt: z.iso.datetime(),
  /** `updated_at` in ms (like list view prefs, D-055). */
  version: z.number().int(),
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

/**
 * `GET /inbox`: the caller's items in Inbox order, every task they show (the items' tasks and
 * all their live subtasks), and each subtask's position among its siblings (its block's).
 */
export const inboxPageSchema = z.object({
  items: z.array(inboxItemSchema),
  tasks: z.array(taskSchema),
  positions: z.record(z.uuid(), z.string()),
});
export type InboxPage = z.infer<typeof inboxPageSchema>;

/** `POST /inbox/tasks`: a new task in no list, added to the caller's Inbox at `position`. */
export const createInboxTaskSchema = clientMutationSchema
  .extend({
    /** Client-generated UUIDv7 (D-006). */
    id: z.uuid(),
    workspaceId: z.uuid(),
    titleInline: taskTitleInlineSchema.default([]),
    position: positionSchema,
  })
  .extend(taskFieldsInputSchema.shape);
export type CreateInboxTask = z.infer<typeof createInboxTaskSchema>;

/** `PUT /inbox/items/:taskId`: add a task to the caller's Inbox, or move it there. */
export const putInboxItemSchema = clientMutationSchema.extend({ position: positionSchema });
export type PutInboxItem = z.infer<typeof putInboxItemSchema>;

/** `DELETE /inbox/items/:taskId`. */
export const deleteInboxItemSchema = clientMutationSchema;
