import { formatDue, isOverdue, type TaskDue } from "@flolist/shared";
import { useQuery } from "@tanstack/react-query";
import { useDateContext } from "./dates.ts";
import { labelsQuery } from "./labels-api.ts";

/** A task's labels, resolved and in order (unknown ids, e.g. just deleted, are skipped). */
export function useTaskLabels(ids: readonly string[]) {
  const { data } = useQuery(labelsQuery);
  return ids.flatMap((id) => {
    const label = data?.find((l) => l.id === id);
    return label ? [label] : [];
  });
}

/** "Tomorrow 5:00 pm", and whether it's overdue (never for completed tasks). */
export function useDueLabel(due: TaskDue | null, completed: boolean) {
  const { now } = useDateContext();
  if (!due) return null;
  return { text: formatDue(due, now.date), overdue: !completed && isOverdue(due, now) };
}
