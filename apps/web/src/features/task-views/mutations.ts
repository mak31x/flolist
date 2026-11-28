import {
  taskPageSchema,
  type InboxPage,
  type InlineNode,
  type Task,
  type TaskDue,
  type TodayPage,
  type Priority,
} from "@flolist/shared";
import { toast } from "@flolist/ui";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useOptimistic } from "../../lib/optimistic.ts";
import { blocksApi } from "../editor/api.ts";
import {
  inboxKey,
  patchTaskInViews,
  removeInboxItem,
  taskViewsApi,
  taskViewsMutationKey,
  todayKey,
  upsertInboxItem,
  upsertTask,
} from "./api.ts";

/**
 * Creates still on their way, by task id: a change to a task typed right after creating it
 * waits for the create, so the PATCH never reaches the server before the task exists.
 */
const creating = new Map<string, Promise<unknown>>();

async function afterCreate(id: string): Promise<void> {
  await creating.get(id)?.catch(() => undefined);
}

/** Every view cache a task change can touch. */
const viewKeys = () => [inboxKey, ["today"], ["task"]];

export interface TaskChange {
  titleInline?: InlineNode[];
  completed?: boolean;
  due?: TaskDue | null;
  priority?: Priority;
  labelIds?: string[];
}

/** The fields of `task` after `change`, as the views show them until the server answers. */
export function applyChange(task: Task, change: TaskChange, userId: string): Task {
  const next: Task = { ...task };
  if (change.titleInline) next.titleInline = change.titleInline;
  if (change.completed !== undefined) {
    next.completedAt = change.completed ? new Date().toISOString() : null;
    next.completedBy = change.completed ? userId : null;
  }
  if (change.due !== undefined) next.due = change.due;
  if (change.priority !== undefined) next.priority = change.priority;
  if (change.labelIds !== undefined) next.labelIds = change.labelIds;
  return next;
}

/** Changes a task shown in Inbox/Today (PATCH /tasks/:id), optimistically. */
export function useUpdateViewTask(userId: string) {
  return useOptimistic<{ id: string; change: TaskChange }, Task>({
    mutationKey: taskViewsMutationKey,
    touches: viewKeys,
    apply: (qc, { id, change }) => {
      patchTaskInViews(qc, id, (task) => applyChange(task, change, userId));
    },
    run: async ({ id, change }) => {
      await afterCreate(id);
      return taskViewsApi.updateTask(id, { clientMutationId: crypto.randomUUID(), ...change });
    },
    error: t("taskViews.saveError"),
  });
}

export interface NewInboxTask {
  task: Task;
  position: string;
}

/**
 * Puts a new Inbox task into the cached views. Callers run it right before `mutate` too, so
 * the row (and its title editor) exists before the next keystroke; repeating it is harmless.
 */
export function seedInboxTask(qc: QueryClient, { task, position }: NewInboxTask): void {
  const now = new Date().toISOString();
  qc.setQueryData<InboxPage>(inboxKey, (old) => {
    if (!old) return old;
    const withTask = { ...old, tasks: upsertTask(old.tasks, task) };
    return upsertInboxItem(withTask, {
      taskId: task.id,
      position,
      reason: "manual",
      addedAt: now,
      version: 0,
    });
  });
  if (task.due) {
    for (const [key, page] of qc.getQueriesData<TodayPage>({ queryKey: ["today"] })) {
      if (page && task.due.date <= page.date) {
        qc.setQueryData<TodayPage>(key, { ...page, open: upsertTask(page.open, task) });
      }
    }
  }
}

/** Takes a seeded task back out of the views (its create failed). */
function unseedInboxTask(qc: QueryClient, { task }: NewInboxTask): void {
  dropFromViews(qc, new Set([task.id]));
}

/** Creates a task in no list straight into the Inbox (the New task row in Inbox and Today). */
export function useCreateInboxTask() {
  return useOptimistic<NewInboxTask, unknown>({
    mutationKey: taskViewsMutationKey,
    touches: viewKeys,
    apply: seedInboxTask,
    rollback: unseedInboxTask,
    run: ({ task, position }) => {
      const sent = taskViewsApi.createInboxTask({
        clientMutationId: crypto.randomUUID(),
        id: task.id,
        workspaceId: task.workspaceId,
        titleInline: task.titleInline,
        position,
        ...(task.due ? { due: task.due } : {}),
      });
      creating.set(task.id, sent);
      return sent.finally(() => {
        if (creating.get(task.id) === sent) creating.delete(task.id);
      });
    },
    error: t("taskViews.createError"),
  });
}

/** Adds a task to the Inbox (or moves it there) at `position`. */
export function usePutInboxItem() {
  return useOptimistic<{ task: Task; position: string }, unknown>({
    mutationKey: taskViewsMutationKey,
    touches: () => [inboxKey],
    apply: (qc, { task, position }) => {
      qc.setQueryData<InboxPage>(inboxKey, (old) => {
        if (!old) return old;
        const current = old.items.find((i) => i.taskId === task.id);
        const withTask = { ...old, tasks: upsertTask(old.tasks, task) };
        return upsertInboxItem(withTask, {
          taskId: task.id,
          position,
          reason: current?.reason ?? "manual",
          addedAt: current?.addedAt ?? new Date().toISOString(),
          version: (current?.version ?? 0) + 1,
        });
      });
    },
    run: async ({ task, position }) => {
      await afterCreate(task.id);
      return taskViewsApi.putInboxItem(task.id, position);
    },
    error: t("taskViews.inboxError"),
  });
}

/** Remove from Inbox (only tasks that also live in a list, D-075). */
export function useRemoveInboxItem() {
  return useOptimistic<{ taskId: string }, unknown>({
    mutationKey: taskViewsMutationKey,
    touches: () => [inboxKey],
    apply: (qc, { taskId }) => {
      qc.setQueryData<InboxPage>(inboxKey, (old) => old && removeInboxItem(old, taskId));
    },
    run: ({ taskId }) => taskViewsApi.removeInboxItem(taskId),
    error: t("taskViews.inboxError"),
  });
}

/** One task's place in Today's manual order for `date`. */
export function usePutTodayOrder() {
  return useOptimistic<{ date: string; taskId: string; position: string }, unknown>({
    mutationKey: taskViewsMutationKey,
    touches: ({ date }) => [todayKey(date)],
    apply: (qc, { date, taskId, position }) => {
      qc.setQueryData<TodayPage>(
        todayKey(date),
        (old) => old && { ...old, order: { ...old.order, [taskId]: position } },
      );
    },
    run: ({ date, taskId, position }) => taskViewsApi.putTodayOrder(date, taskId, position),
    error: t("taskViews.saveError"),
  });
}

/** Overdue → Reschedule all: every listed task becomes due on `date`, keeping its time. */
export function useReschedule() {
  return useOptimistic<{ date: string; tasks: Task[] }, unknown>({
    mutationKey: taskViewsMutationKey,
    touches: viewKeys,
    apply: (qc, { date, tasks }) => {
      for (const task of tasks) {
        patchTaskInViews(qc, task.id, (x) => ({
          ...x,
          due: x.due ? { ...x.due, date } : x.due,
        }));
      }
    },
    run: ({ date, tasks }) =>
      taskViewsApi.reschedule(
        date,
        tasks.map((x) => x.id),
      ),
    error: t("taskViews.saveError"),
  });
}

/** Where a task's block lives, so a delete goes through the right page's batch. */
async function pageBatchOf(task: Task) {
  if (task.listId) {
    const listId = task.listId;
    return (ops: Parameters<typeof blocksApi.batch>[1]["ops"]) =>
      blocksApi.batch(listId, { clientMutationId: crypto.randomUUID(), ops });
  }
  const page = await api("GET", `/tasks/${task.id}/page`, taskPageSchema);
  return (ops: Parameters<typeof blocksApi.batch>[1]["ops"]) =>
    blocksApi.taskBatch(page.taskId, { clientMutationId: crypto.randomUUID(), ops });
}

function dropFromViews(qc: QueryClient, ids: ReadonlySet<string>) {
  qc.setQueryData<InboxPage>(
    inboxKey,
    (old) =>
      old && {
        ...old,
        items: old.items.filter((i) => !ids.has(i.taskId)),
        tasks: old.tasks.filter((x) => !ids.has(x.id)),
      },
  );
  for (const [key, page] of qc.getQueriesData<TodayPage>({ queryKey: ["today"] })) {
    if (!page) continue;
    qc.setQueryData<TodayPage>(key, {
      ...page,
      open: page.open.filter((x) => !ids.has(x.id)),
      completed: page.completed.filter((x) => !ids.has(x.id)),
    });
  }
}

/**
 * Deletes tasks shown in a view, with an Undo toast. A task in no list goes through
 * DELETE /tasks/:id; any other task through its block on its page (one batch per page).
 */
export function useDeleteViewTasks() {
  const qc = useQueryClient();
  return async (tasks: readonly Task[]) => {
    if (tasks.length === 0) return;
    const ids = new Set(tasks.map((x) => x.id));
    const snapshot = qc
      .getQueriesData({ queryKey: inboxKey })
      .concat(qc.getQueriesData({ queryKey: ["today"] }));
    dropFromViews(qc, ids);
    const undo: (() => Promise<unknown>)[] = [];
    try {
      for (const task of tasks) {
        if (!task.listId && !task.parentTaskId) {
          await taskViewsApi.deleteTask(task.id);
          undo.push(() => taskViewsApi.restoreTask(task.id));
        } else if (task.blockId) {
          const blockId = task.blockId;
          const send = await pageBatchOf(task);
          await send([{ op: "delete", id: blockId }]);
          undo.push(() => send([{ op: "upsert", id: blockId }]));
        }
      }
    } catch {
      for (const [key, data] of snapshot) qc.setQueryData(key, data);
      toast(t("taskViews.deleteError"));
      return;
    } finally {
      void qc.invalidateQueries({ queryKey: inboxKey });
      void qc.invalidateQueries({ queryKey: ["today"] });
    }
    toast(t("tasks.actions.deleted", { count: tasks.length }), {
      action: {
        label: t("tasks.details.undo"),
        onAction: () => {
          void Promise.all(undo.map((fn) => fn())).finally(() => {
            void qc.invalidateQueries({ queryKey: inboxKey });
            void qc.invalidateQueries({ queryKey: ["today"] });
          });
        },
      },
    });
  };
}
