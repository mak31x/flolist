import {
  inboxItemSchema,
  inboxPageSchema,
  taskSchema,
  todayOrderSchema,
  todayPageSchema,
  type ChangeEvent,
  type CreateInboxTask,
  type InboxItem,
  type InboxPage,
  type Task,
  type TodayPage,
  type UpdateTask,
} from "@flolist/shared";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../../lib/api.ts";

/**
 * The cross-list task views (views.md → Inbox, Today): their queries, the cache patches live
 * events make, and the REST calls their optimistic mutations use.
 */

export const inboxKey = ["inbox"] as const;
export const taskKey = (id: string) => ["task", id] as const;
export const todayKey = (date: string) => ["today", date] as const;
/** While one of these is pending, live task events for the views wait for its refetch. */
export const taskViewsMutationKey = ["taskViews"] as const;

/** One task as the details panel of a view shows it (`GET /tasks/:id`). */
export const taskQuery = (id: string) =>
  queryOptions({
    queryKey: taskKey(id),
    queryFn: () => api("GET", `/tasks/${id}`, taskSchema),
    staleTime: 30_000,
  });

export const inboxQuery = queryOptions({
  queryKey: inboxKey,
  queryFn: () => api("GET", "/inbox", inboxPageSchema),
  staleTime: 30_000,
});

export const todayQuery = (date: string) =>
  queryOptions({
    queryKey: todayKey(date),
    queryFn: () => api("GET", `/today?date=${date}`, todayPageSchema),
    staleTime: 30_000,
  });

const createdInboxTaskSchema = z.object({ task: taskSchema, item: inboxItemSchema });
const removedSchema = z.object({ removed: z.boolean() });
const changedSchema = z.object({ changed: z.array(z.uuid()) });
const trashSchema = z.object({ deleted: z.array(z.uuid()) });
const restoredSchema = z.object({ restored: z.array(z.uuid()) });

export const taskViewsApi = {
  updateTask: (id: string, input: UpdateTask) => api("PATCH", `/tasks/${id}`, taskSchema, input),
  createInboxTask: (input: CreateInboxTask) =>
    api("POST", "/inbox/tasks", createdInboxTaskSchema, input),
  putInboxItem: (taskId: string, position: string) =>
    api("PUT", `/inbox/items/${taskId}`, inboxItemSchema, {
      clientMutationId: crypto.randomUUID(),
      position,
    }),
  removeInboxItem: (taskId: string) =>
    api("DELETE", `/inbox/items/${taskId}`, removedSchema, {
      clientMutationId: crypto.randomUUID(),
    }),
  putTodayOrder: (date: string, taskId: string, position: string) =>
    api("PUT", "/today/order", todayOrderSchema, {
      clientMutationId: crypto.randomUUID(),
      date,
      taskId,
      position,
    }),
  reschedule: (date: string, taskIds: string[]) =>
    api("POST", "/today/reschedule", changedSchema, {
      clientMutationId: crypto.randomUUID(),
      date,
      taskIds,
    }),
  deleteTask: (id: string) =>
    api("DELETE", `/tasks/${id}`, trashSchema, { clientMutationId: crypto.randomUUID() }),
  restoreTask: (id: string) =>
    api("POST", `/tasks/${id}/restore`, restoredSchema, { clientMutationId: crypto.randomUUID() }),
};

// ---- Pure cache patches ----------------------------------------------------------------------

const newer = (current: { version: number } | undefined, next: { version: number }) =>
  !current || next.version > current.version;

/** Replaces (or adds) a task in a list of tasks when it's newer. */
export function upsertTask(tasks: readonly Task[], task: Task): Task[] {
  const index = tasks.findIndex((x) => x.id === task.id);
  if (index === -1) return [...tasks, task];
  if (!newer(tasks[index], task)) return [...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

/** Applies `patch` to one task in every cached view, bumping nothing (the server answers). */
export function patchTaskInViews(qc: QueryClient, id: string, patch: (task: Task) => Task): void {
  qc.setQueryData<Task>(taskKey(id), (old) => old && patch(old));
  qc.setQueryData<InboxPage>(
    inboxKey,
    (old) => old && { ...old, tasks: old.tasks.map((x) => (x.id === id ? patch(x) : x)) },
  );
  for (const [key, page] of qc.getQueriesData<TodayPage>({ queryKey: ["today"] })) {
    if (!page) continue;
    qc.setQueryData<TodayPage>(key, {
      ...page,
      open: page.open.map((x) => (x.id === id ? patch(x) : x)),
      completed: page.completed.map((x) => (x.id === id ? patch(x) : x)),
    });
  }
}

export function upsertInboxItem(page: InboxPage, item: InboxItem): InboxPage {
  const current = page.items.find((i) => i.taskId === item.taskId);
  if (current && !newer(current, item)) return page;
  return { ...page, items: [...page.items.filter((i) => i.taskId !== item.taskId), item] };
}

export function removeInboxItem(page: InboxPage, taskId: string): InboxPage {
  return { ...page, items: page.items.filter((i) => i.taskId !== taskId) };
}

/**
 * Live events for the task views (called from `applyChange`). Task fields patch in place;
 * anything that can change which tasks a view holds (a new subtask, a deleted task, a moved due
 * date) refetches that view, since the server decides membership.
 */
export function applyTaskViewChange(qc: QueryClient, event: ChangeEvent): void {
  if (qc.isMutating({ mutationKey: taskViewsMutationKey }) > 0) return;
  switch (event.entity) {
    case "task": {
      if (event.op === "upsert") {
        qc.setQueryData<Task>(taskKey(event.id), (old) =>
          old && event.data.version > old.version ? event.data : old,
        );
      } else {
        void qc.invalidateQueries({ queryKey: taskKey(event.id) });
      }
      const inbox = qc.getQueryData<InboxPage>(inboxKey);
      if (inbox) {
        const known = inbox.tasks.some((x) => x.id === event.id);
        if (event.op === "upsert" && known) {
          qc.setQueryData<InboxPage>(inboxKey, {
            ...inbox,
            tasks: upsertTask(inbox.tasks, event.data),
          });
        } else if (
          event.op === "delete" ||
          (event.data.parentTaskId && inbox.tasks.some((x) => x.id === event.data.parentTaskId))
        ) {
          void qc.invalidateQueries({ queryKey: inboxKey });
        }
      }
      void qc.invalidateQueries({ queryKey: ["today"] });
      return;
    }
    case "inboxItem": {
      const inbox = qc.getQueryData<InboxPage>(inboxKey);
      if (!inbox) return;
      if (event.op === "delete") {
        qc.setQueryData<InboxPage>(inboxKey, removeInboxItem(inbox, event.id));
      } else if (inbox.tasks.some((x) => x.id === event.id)) {
        qc.setQueryData<InboxPage>(inboxKey, upsertInboxItem(inbox, event.data));
      } else {
        void qc.invalidateQueries({ queryKey: inboxKey });
      }
      return;
    }
    case "todayOrder": {
      qc.setQueryData<TodayPage>(
        todayKey(event.data.date),
        (old) =>
          old && { ...old, order: { ...old.order, [event.data.taskId]: event.data.position } },
      );
      return;
    }
    default:
      return;
  }
}
