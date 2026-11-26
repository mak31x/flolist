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

/**
 * The block store for one open list. Pending changes are flushed when the list closes, when
 * the tab is hidden and when the page goes away (`keepalive`, so the request survives).
 */
export function useBlockStore(listId: string, rootListId: string, userId: string | null) {
  const qc = useQueryClient();
  const [store] = useState(
    () =>
      new BlockStore({
        qc,
        listId,
        rootListId,
        userId,
        ready: () => listCreated(qc, listId),
        onError: () => {
          toast(t("editor.saveError"));
        },
      }),
  );

  useEffect(() => {
    const unregister = registerBlockStore(store);
    const flushNow = () => {
      void store.flush({ keepalive: true });
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onHidden);
      // Keep receiving live events until the last batch lands, then let go.
      void store.flush().finally(() => {
        store.dispose();
        unregister();
      });
    };
  }, [store]);

  return store;
}
