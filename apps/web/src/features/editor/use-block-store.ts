import type { BlockContainer } from "@flolist/shared";
import { toast } from "@flolist/ui";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { t } from "../../i18n/index.ts";
import { mutationKeys } from "../sync/apply-change.ts";
import { BlockStore, registerBlockStore } from "./store.ts";

/** Resolves once no "create list" mutation for `listId` is pending (its blocks can be saved). */
function listCreated(qc: QueryClient, listId: string): Promise<void> {
  const cache = qc.getMutationCache();
  const pending = () =>
    cache
      .findAll({ mutationKey: mutationKeys.sidebar, status: "pending" })
      .some((m) => (m.state.variables as { id?: unknown } | undefined)?.id === listId);
  if (!pending()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = cache.subscribe(() => {
      if (pending()) return;
      unsubscribe();
      resolve();
    });
  });
}

interface Shared {
  store: BlockStore;
  users: number;
  detach: (() => void) | null;
}

/**
 * One store per open list page, shared by every editor showing it (the list and a task's
 * details panel edit the same cache), counted by its mounted users.
 */
const shared = new Map<string, Shared>();

function storeFor(
  qc: QueryClient,
  listId: string,
  rootListId: string | null,
  userId: string | null,
  pageKind: BlockContainer["type"],
) {
  let entry = shared.get(listId);
  if (!entry) {
    entry = {
      store: new BlockStore({
        qc,
        listId,
        rootListId,
        pageKind,
        userId,
        ready: () => listCreated(qc, listId),
        onError: () => {
          toast(t("editor.saveError"));
        },
      }),
      users: 0,
      detach: null,
    };
    shared.set(listId, entry);
  }
  return entry;
}

/** Counts a user of the store (attaching it on the first); returns the release. */
function acquire(entry: Shared, listId: string): () => void {
  const { store } = entry;
  entry.users += 1;
  shared.set(listId, entry);
  if (!entry.detach) {
    const unregister = registerBlockStore(store);
    const flushNow = () => {
      void store.flush({ keepalive: true });
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onHidden);
    entry.detach = () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onHidden);
      unregister();
    };
  }
  return () => {
    entry.users -= 1;
    if (entry.users > 0) return;
    // Keep receiving live events until the last batch lands, then let go (unless an editor
    // took the store again meanwhile, e.g. StrictMode's remount).
    void store.flush().finally(() => {
      if (entry.users > 0) return;
      store.dispose();
      entry.detach?.();
      entry.detach = null;
      if (shared.get(listId) === entry) shared.delete(listId);
    });
  };
}

/**
 * The block store for one open page (a list, or the body page of a task in no list). Pending changes are flushed when the last editor
 * using it closes, when the tab is hidden and when the page goes away (`keepalive`, so the
 * request survives).
 */
export function useBlockStore(
  listId: string,
  rootListId: string | null,
  userId: string | null,
  pageKind: BlockContainer["type"] = "list",
) {
  const qc = useQueryClient();
  const [entry] = useState(() => storeFor(qc, listId, rootListId, userId, pageKind));

  useEffect(() => acquire(entry, listId), [entry, listId]);

  return entry.store;
}
