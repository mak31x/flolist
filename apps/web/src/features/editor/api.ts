import {
  blockBatchResultSchema,
  blockPageSchema,
  taskPageSchema,
  type Block,
  type BlockBatch,
  type MoveBlocksTo,
} from "@flolist/shared";
import { queryOptions } from "@tanstack/react-query";
import { api, type ApiOptions } from "../../lib/api.ts";
// A cycle with store.ts, used only inside functions (never at module load).
import { mergeFetchedBlocks } from "./store.ts";

export const blocksKey = (listId: string) => ["blocks", listId] as const;

/**
 * A page's live blocks in order: a list page (default), or the body page of a top-level task
 * in no list (M4.1), keyed by the task id. Kept fresh by live sync, so it rarely refetches.
 */
export const blocksQuery = (listId: string, kind: "list" | "task" = "list") =>
  queryOptions({
    queryKey: blocksKey(listId),
    queryFn: async (): Promise<Block[]> =>
      mergeFetchedBlocks(
        listId,
        kind === "list"
          ? (await api("GET", `/lists/${listId}/blocks`, blockPageSchema)).items
          : (await api("GET", `/tasks/${listId}/page`, taskPageSchema)).items,
      ),
    staleTime: 60_000,
  });

export const blocksApi = {
  batch: (listId: string, input: BlockBatch, options?: ApiOptions) =>
    api("POST", `/lists/${listId}/blocks/batch`, blockBatchResultSchema, input, options),
  /** The batch of a task page (`listId` is the top-level task's id there). */
  taskBatch: (taskId: string, input: BlockBatch, options?: ApiOptions) =>
    api("POST", `/tasks/${taskId}/blocks/batch`, blockBatchResultSchema, input, options),
  moveTo: (listId: string, input: MoveBlocksTo) =>
    api("POST", `/lists/${listId}/blocks/move-to`, blockBatchResultSchema, input),
};
