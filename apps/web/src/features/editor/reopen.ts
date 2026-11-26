import { toast } from "@flolist/ui";
import { t } from "../../i18n/index.ts";
import type { BlockStore, LocalOp } from "./store.ts";

/**
 * ⋮ → Mark all incomplete: reopens every completed task on the list page (its tasks and their
 * subtasks, not those of sublists `[assumption]`) as one batch, with an Undo toast.
 */
export function markAllIncomplete(store: BlockStore): void {
  const ops: LocalOp[] = store.blocks
    .filter((b) => b.type === "task" && b.task?.completedAt)
    .map((b) => ({ op: "upsert", id: b.id, fields: { completed: false } }));
  if (ops.length === 0) return;
  const inverse = store.apply(ops);
  toast(t("lists.reopened", { count: ops.length }), {
    action: {
      label: t("tasks.details.undo"),
      onAction: () => {
        store.apply(inverse);
      },
    },
  });
}
