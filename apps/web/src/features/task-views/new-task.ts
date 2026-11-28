import { compareKeys, positionBetween, uuidv7, type InboxPage, type Task } from "@flolist/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMe } from "../auth/hooks.ts";
import { focusBlock } from "../editor/focus.ts";
import { workspacesQuery } from "../workspaces/api.ts";
import { inboxKey, inboxQuery } from "./api.ts";
import { seedInboxTask, useCreateInboxTask } from "./mutations.ts";

/** A new, empty task in no list, in the caller's Personal workspace. */
export function blankTask(workspaceId: string, userId: string, due: Task["due"] = null): Task {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    workspaceId,
    listId: null,
    rootListId: null,
    parentTaskId: null,
    blockId: null,
    title: "",
    titleInline: [],
    completedAt: null,
    completedBy: null,
    due,
    priority: 0,
    labelIds: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

/** The caller's Personal workspace (where new Inbox tasks go until the workspace filter, M7.1). */
export function usePersonalWorkspaceId(): string | undefined {
  const { data } = useQuery(workspacesQuery);
  return data?.find((w) => w.kind === "personal")?.id;
}

/**
 * Quick create → New task (views.md → Sidebar §5): a new task at the top of the Inbox, then the
 * Inbox opens with its title focused.
 */
export function useQuickNewTask(): (() => Promise<void>) | null {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const workspaceId = usePersonalWorkspaceId();
  const create = useCreateInboxTask();
  if (!workspaceId) return null;
  return async () => {
    // The Inbox must be cached for the new row to show (and take typing) right away.
    await qc.query({ ...inboxQuery, staleTime: "static" }).catch(() => undefined);
    const first = qc
      .getQueryData<InboxPage>(inboxKey)
      ?.items.map((i) => i.position)
      .sort(compareKeys)[0];
    const task = blankTask(workspaceId, me.id);
    const vars = { task, position: positionBetween(null, first ?? null) };

    seedInboxTask(qc, vars);

    create.mutate(vars);
    void navigate({ to: "/inbox" }).then(() => {
      focusBlock(task.id, "end");
    });
  };
}
