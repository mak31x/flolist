import type { ChangeEvent, ListIndexItem, Sidebar } from "@flolist/shared";
import type { QueryClient } from "@tanstack/react-query";
import { applyBlockChange, type BlockChangeEvent } from "../editor/store.ts";
import { listKey, listPrefsKey, listsKey, sidebarKey } from "../lists/api.ts";
import {
  removeEntry,
  removeList,
  removeSection,
  upsertEntry,
  upsertList,
  upsertSection,
} from "../lists/cache.ts";

/** Mutation keys: while one is pending, live events for the same data wait for its refetch. */
export const mutationKeys = {
  list: (id: string) => ["list", id] as const,
  listPrefs: (id: string) => ["listPrefs", id] as const,
  sidebar: ["sidebar"] as const,
};

const isNewer = (current: { version: number } | undefined, version: number) =>
  !current || version > current.version;

/**
 * Patches the TanStack Query cache with one live change (architecture.md → Live sync).
 * - Older or equal versions are ignored, so echoes of our own writes and repeated deliveries
 *   (the outbox is at-least-once) change nothing.
 * - While a local mutation on the same data is in flight the event is skipped; that mutation
 *   refetches when it settles, which picks up anything skipped.
 */
export function applyChange(qc: QueryClient, event: ChangeEvent): void {
  switch (event.entity) {
    case "list": {
      if (qc.isMutating({ mutationKey: mutationKeys.list(event.id) }) > 0) return;
      if (event.op === "delete") {
        qc.setQueryData<ListIndexItem[]>(listsKey, (old) => old && removeList(old, event.id));
        qc.setQueryData<ListIndexItem | null>(listKey(event.id), null);
        // The server keeps the entry for a restore but stops returning it.
        qc.setQueryData<Sidebar>(sidebarKey, (old) => old && removeEntry(old, event.id));
        return;
      }
      const { data } = event;
      qc.setQueryData<ListIndexItem[]>(listsKey, (old) => {
        if (!old) return old;
        return isNewer(
          old.find((l) => l.id === event.id),
          event.version,
        )
          ? upsertList(old, data)
          : old;
      });
      qc.setQueryData<ListIndexItem | null>(listKey(event.id), (old) =>
        old && isNewer(old, event.version) ? { ...data, lastOpenedAt: old.lastOpenedAt } : old,
      );
      return;
    }
    case "section": {
      if (qc.isMutating({ mutationKey: mutationKeys.sidebar }) > 0) return;
      qc.setQueryData<Sidebar>(sidebarKey, (old) => {
        if (!old) return old;
        if (event.op === "delete") return removeSection(old, event.id);
        return isNewer(
          old.sections.find((s) => s.id === event.id),
          event.version,
        )
          ? upsertSection(old, event.data)
          : old;
      });
      return;
    }
    case "sidebarEntry": {
      if (qc.isMutating({ mutationKey: mutationKeys.sidebar }) > 0) return;
      qc.setQueryData<Sidebar>(sidebarKey, (old) => {
        if (!old) return old;
        if (event.op === "delete") return removeEntry(old, event.id);
        const current = old.entries.find((e) => e.listId === event.id);
        // A starred list we don't know yet: refetch the index so the sidebar can title it.
        if (!current) void qc.invalidateQueries({ queryKey: listsKey });
        return isNewer(current, event.version) ? upsertEntry(old, event.data) : old;
      });
      return;
    }
    case "listPrefs":
      if (qc.isMutating({ mutationKey: mutationKeys.listPrefs(event.id) }) > 0) return;
      qc.setQueryData(listPrefsKey(event.id), event.data);
      return;
    case "block":
      // Blocks merge with the editor's own queue instead of waiting on mutations (D-045).
      applyBlockChange(qc, event as BlockChangeEvent);
      return;
  }
}

/** Refetches what an `access_changed` event may have changed (list index and sidebar). */
export function applyAccessChanged(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: listsKey });
  void qc.invalidateQueries({ queryKey: sidebarKey });
}
