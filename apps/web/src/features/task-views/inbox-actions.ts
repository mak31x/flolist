import { compareKeys, positionBetween, type InboxPage } from "@flolist/shared";
import { toast } from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { applyBlockChange } from "../editor/store.ts";
import { inboxKey, inboxQuery, removeInboxItem, taskViewsApi, upsertInboxItem } from "./api.ts";

/**
 * Add to / Remove from Inbox and Remove from list for the task action registry (tasks.md →
 * Task actions; ⌘⇧I, ⌘⇧R). Each takes task ids; Inbox membership comes from the Inbox query.
 */
export interface InboxActions {
  has: (taskId: string) => boolean;
  add: (taskIds: readonly string[]) => void;
  remove: (taskIds: readonly string[]) => void;
  /** Takes tasks out of their list into the Inbox; `blockIds` leave the open page at once. */
  removeFromList: (tasks: readonly { taskId: string; blockIds: readonly string[] }[]) => void;
}

export function useInboxActions(): InboxActions {
  const qc = useQueryClient();
  const { data: inbox } = useQuery(inboxQuery);
  return useMemo<InboxActions>(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: inboxKey });
    const ids = new Set(inbox?.items.map((i) => i.taskId) ?? []);
    return {
      has: (taskId) => ids.has(taskId),
      add: (taskIds) => {
        const current = qc.getQueryData<InboxPage>(inboxKey);
        // New items go to the top, in the order given.
        let next = current?.items.map((i) => i.position).sort(compareKeys)[0] ?? null;
        const placed = [...taskIds].reverse().map((taskId) => {
          const position = positionBetween(null, next);
          next = position;
          return { taskId, position };
        });
        qc.setQueryData<InboxPage>(inboxKey, (old) =>
          placed.reduce(
            (page, { taskId, position }) =>
              upsertInboxItem(page, {
                taskId,
                position,
                reason: "manual",
                addedAt: new Date().toISOString(),
                version: Number.MAX_SAFE_INTEGER,
              }),
            old ?? { items: [], tasks: [], positions: {} },
          ),
        );
        void Promise.all(placed.map((p) => taskViewsApi.putInboxItem(p.taskId, p.position)))
          .then(() => {
            toast(t("taskViews.addedToInbox", { count: placed.length }));
          })
          .catch(() => {
            toast(t("taskViews.inboxError"));
          })
          .finally(() => void refresh());
      },
      remove: (taskIds) => {
        qc.setQueryData<InboxPage>(
          inboxKey,
          (old) => old && taskIds.reduce((page, id) => removeInboxItem(page, id), old),
        );
        void Promise.all(taskIds.map((id) => taskViewsApi.removeInboxItem(id)))
          .catch(() => {
            toast(t("taskViews.inboxError"));
          })
          .finally(() => void refresh());
      },
      removeFromList: (tasks) => {
        for (const { blockIds } of tasks) {
          for (const id of blockIds) {
            applyBlockChange(qc, {
              type: "change",
              op: "delete",
              entity: "block",
              id,
              version: Number.MAX_SAFE_INTEGER,
              clientMutationId: null,
            });
          }
        }
        void Promise.all(
          tasks.map(({ taskId }) =>
            api("POST", `/tasks/${taskId}/move`, undefined, {
              clientMutationId: crypto.randomUUID(),
              listId: null,
            }),
          ),
        )
          .then(() => {
            toast(t("taskViews.movedToInbox", { count: tasks.length }));
          })
          .catch(() => {
            toast(t("taskViews.moveError"));
          })
          .finally(() => {
            void refresh();
            void qc.invalidateQueries({ queryKey: ["blocks"] });
          });
      },
    };
  }, [qc, inbox]);
}
