import {
  blockBatchResultSchema,
  blockPageSchema,
  type Block,
  type BlockBatch,
  type MoveBlocksTo,
} from "@flolist/shared";
import { queryOptions } from "@tanstack/react-query";
import { api, type ApiOptions } from "../../lib/api.ts";
// A cycle with store.ts, used only inside functions (never at module load).
import { mergeFetchedBlocks } from "./store.ts";

export const blocksKey = (listId: string) => ["blocks", listId] as const;

/** A list's live blocks in order. Kept fresh by live sync, so it rarely refetches. */
export const blocksQuery = (listId: string) =>
  queryOptions({
    queryKey: blocksKey(listId),
    queryFn: async (): Promise<Block[]> =>
      mergeFetchedBlocks(
        listId,
        (await api("GET", `/lists/${listId}/blocks`, blockPageSchema)).items,
      ),
    staleTime: 60_000,
  });

export const blocksApi = {
  batch: (listId: string, input: BlockBatch, options?: ApiOptions) =>
    api("POST", `/lists/${listId}/blocks/batch`, blockBatchResultSchema, input, options),
  moveTo: (listId: string, input: MoveBlocksTo) =>
    api("POST", `/lists/${listId}/blocks/move-to`, blockBatchResultSchema, input),
};
