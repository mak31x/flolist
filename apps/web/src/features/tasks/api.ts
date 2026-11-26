import { activityPageSchema, type ActivityEvent } from "@flolist/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const activityKey = (taskId: string) => ["taskActivity", taskId] as const;

/**
 * A task's activity log, oldest first. Live `task` events invalidate it, since every logged
 * change also bumps the task (D-056).
 */
export const activityQuery = (taskId: string) =>
  queryOptions({
    queryKey: activityKey(taskId),
    queryFn: async (): Promise<ActivityEvent[]> =>
      (await api("GET", `/tasks/${taskId}/activity`, activityPageSchema)).items,
    staleTime: 30_000,
  });
