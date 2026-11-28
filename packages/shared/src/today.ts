import { z } from "zod";
import { clientMutationSchema } from "./lists.ts";
import { positionSchema } from "./positions.ts";
import { isoDateSchema } from "./task-fields.ts";
import { taskSchema } from "./tasks.ts";

/**
 * Today (views.md → Today): every task the caller can access that is open and due on the shown
 * day or earlier, plus the tasks completed that day (the Completed tab). Days are calendar days
 * in the caller's profile time zone.
 */

export const todayQuerySchema = z.object({ date: isoDateSchema });

/**
 * `GET /today?date=`: `open` holds overdue tasks too (due before `date`; the view groups them),
 * `completed` the tasks completed on `date`, `order` the caller's manual order for that day.
 */
export const todayPageSchema = z.object({
  date: isoDateSchema,
  open: z.array(taskSchema),
  completed: z.array(taskSchema),
  order: z.record(z.uuid(), z.string()),
});
export type TodayPage = z.infer<typeof todayPageSchema>;

/** One task's manual place in Today on one day (stored per user per day `[assumption]`). */
export const todayOrderSchema = z.object({
  date: isoDateSchema,
  taskId: z.uuid(),
  position: z.string(),
  /** `updated_at` in ms. */
  version: z.number().int(),
});
export type TodayOrder = z.infer<typeof todayOrderSchema>;

/** `PUT /today/order`: place a task in the day's manual order. */
export const putTodayOrderSchema = clientMutationSchema.extend({
  date: isoDateSchema,
  taskId: z.uuid(),
  position: positionSchema,
});
export type PutTodayOrder = z.infer<typeof putTodayOrderSchema>;

/** Most tasks one "Reschedule all" moves `[assumption]`. */
export const MAX_RESCHEDULE = 500;

/**
 * `POST /today/reschedule`: Overdue → "Reschedule all" moves each task's due date to `date`,
 * keeping its time and zone.
 */
export const rescheduleSchema = clientMutationSchema.extend({
  date: isoDateSchema,
  taskIds: z.array(z.uuid()).min(1).max(MAX_RESCHEDULE),
});
export type Reschedule = z.infer<typeof rescheduleSchema>;
