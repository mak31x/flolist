import {
  DEFAULT_LIST_VIEW_PREFS,
  positionAfter,
  type ListViewPrefs,
  uuidv7,
  type Block,
  type ListIndexItem,
  type Section,
  type Sidebar,
  type SidebarEntry,
} from "@flolist/shared";
import { toast } from "@flolist/ui";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { meQuery } from "../auth/api.ts";
import { blocksKey } from "../editor/api.ts";
import { mutationKeys } from "../sync/apply-change.ts";
import { t } from "../../i18n/index.ts";
import { listKey, listPrefsKey, listsApi, listsKey, sidebarKey } from "./api.ts";
import {
  defaultSection,
  entriesOf,
  patchList,
  removeEntry,
  removeList,
  removeSection,
  upsertEntry,
  upsertList,
  upsertSection,
} from "./cache.ts";

type Snapshot = [QueryKey, unknown][];

/**
 * The optimistic pattern every list/sidebar action uses (CLAUDE.md → Optimistic UI): patch the
 * cache at once, roll back and toast on error, and refetch the touched queries once the last
 * pending mutation with the same key settles (which also picks up live events skipped
 * meanwhile, see `applyChange`).
 */
function useOptimistic<V, R>(options: {
  mutationKey: QueryKey;
  touches: (vars: V) => QueryKey[];
  apply: (qc: QueryClient, vars: V) => void;
  run: (vars: V) => Promise<R>;
  error: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: options.mutationKey,
    mutationFn: options.run,
    onMutate: async (vars: V) => {
      const keys = options.touches(vars);
      await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
      const snapshot: Snapshot = keys.map((k) => [k, qc.getQueryData(k)]);
      options.apply(qc, vars);
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      toast(options.error);
    },
    onSettled: async (_data, _err, vars) => {
      if (qc.isMutating({ mutationKey: options.mutationKey }) > 1) return;
      await Promise.all(
        options.touches(vars).map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
}

const getSidebar = (qc: QueryClient) => qc.getQueryData<Sidebar>(sidebarKey);

/** Where a new star goes: the end of `sectionId` (default: Favorites). */
export function nextEntrySlot(sidebar: Sidebar | undefined, sectionId?: string) {
  const section = sectionId ?? (sidebar ? defaultSection(sidebar)?.id : undefined);
  if (!sidebar || !section) return null;
  const last = entriesOf(sidebar, section).at(-1);
  return { sectionId: section, position: positionAfter(last?.position ?? null) };
}

interface CreateListVars {
  id: string;
  title?: string;
  emoji?: string | null;
  sectionId?: string;
  position?: string;
}

/**
 * Creates a list and stars it (Favorites unless a section is given). `create()` returns the
 * new id right away so the caller can navigate before the server answers.
 */
export function useCreateList() {
  const mutation = useOptimistic<CreateListVars, unknown>({
    mutationKey: mutationKeys.sidebar,
    touches: (v) => [listsKey, sidebarKey, listKey(v.id)],
    apply: (qc, v) => {
      const me = qc.getQueryData(meQuery.queryKey);
      const now = new Date().toISOString();
      const list: ListIndexItem = {
        id: v.id,
        workspaceId: "",
        rootListId: v.id,
        parentListId: null,
        parentBlockId: null,
        title: v.title ?? "",
        emoji: v.emoji ?? null,
        cover: null,
        createdBy: me?.id ?? "",
        version: 1,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      };
      qc.setQueryData<ListIndexItem[]>(listsKey, (old) => upsertList(old ?? [], list));
      qc.setQueryData(listKey(v.id), list);
      // A new list has no blocks: the editor can open at once (and Enter in the title can move
      // into its first block) without waiting for a fetch.
      qc.setQueryData<Block[]>(blocksKey(v.id), []);
      if (v.sectionId && v.position) {
        const entry: SidebarEntry = {
          listId: v.id,
          sectionId: v.sectionId,
          position: v.position,
          version: 1,
        };
        qc.setQueryData<Sidebar>(sidebarKey, (old) => old && upsertEntry(old, entry));
      }
    },
    run: (v) =>
      listsApi.create({
        clientMutationId: uuidv7(),
        id: v.id,
        title: v.title ?? "",
        ...(v.emoji !== undefined ? { emoji: v.emoji } : {}),
        ...(v.sectionId ? { sectionId: v.sectionId } : {}),
        ...(v.position ? { position: v.position } : {}),
      }),
    error: t("lists.createError"),
  });
  const qc = useQueryClient();
  return {
    ...mutation,
    create: (vars: Omit<CreateListVars, "id" | "position"> = {}): string => {
      const id = uuidv7();
      const slot = nextEntrySlot(getSidebar(qc), vars.sectionId);
      mutation.mutate({ ...vars, id, ...(slot ?? {}) });
      return id;
    },
  };
}

/** Renames a list or changes its emoji (field-level PATCH). */
export function useUpdateList(
  id: string,
  options: {
    /** Resolves once the list exists on the server (a sublist is created with its block). */
    ready?: () => Promise<void>;
  } = {},
) {
  const qc = useQueryClient();
  return useOptimistic<
    { title?: string; emoji?: string | null; cover?: ListIndexItem["cover"] },
    unknown
  >({
    mutationKey: mutationKeys.list(id),
    touches: () => [listsKey, listKey(id)],
    apply: (qc, patch) => {
      qc.setQueryData<ListIndexItem[]>(listsKey, (old) => old && patchList(old, id, patch));
      qc.setQueryData<ListIndexItem | null>(listKey(id), (old) => old && { ...old, ...patch });
    },
    run: async (patch) => {
      await options.ready?.();
      const known =
        qc.getQueryData<ListIndexItem | null>(listKey(id)) ??
        qc.getQueryData<ListIndexItem[]>(listsKey)?.find((l) => l.id === id);
      return listsApi.update(id, {
        clientMutationId: uuidv7(),
        // An optimistic sublist has version 0 until the server's copy arrives.
        baseVersion: Math.max(1, known?.version ?? 1),
        ...patch,
      });
    },
    error: t("lists.saveError"),
  });
}

/** Moves a list to Trash. */
export function useDeleteList() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => listsApi.remove(id, uuidv7()),
    onMutate: async (id: string) => {
      const keys: QueryKey[] = [listsKey, sidebarKey, listKey(id)];
      await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
      const snapshot: Snapshot = keys.map((k) => [k, qc.getQueryData(k)]);
      qc.setQueryData<ListIndexItem[]>(listsKey, (old) => old && removeList(old, id));
      qc.setQueryData<Sidebar>(sidebarKey, (old) => old && removeEntry(old, id));
      qc.setQueryData(listKey(id), null);
      return { snapshot };
    },
    onError: (_err, _id, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      toast(t("lists.deleteError"));
    },
    onSuccess: () => {
      toast(t("lists.deleted"));
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: listsKey }),
        qc.invalidateQueries({ queryKey: sidebarKey }),
      ]),
  });
  return mutation;
}

/** Stars a list into a section, or moves its entry; omit the slot to append to Favorites. */
export function usePutEntry() {
  const qc = useQueryClient();
  const mutation = useOptimistic<SidebarEntry, unknown>({
    mutationKey: mutationKeys.sidebar,
    touches: () => [sidebarKey],
    apply: (q, entry) => {
      q.setQueryData<Sidebar>(sidebarKey, (old) => old && upsertEntry(old, entry));
    },
    run: (entry) =>
      listsApi.putEntry(entry.listId, {
        clientMutationId: uuidv7(),
        sectionId: entry.sectionId,
        position: entry.position,
      }),
    error: t("sidebar.saveError"),
  });
  return {
    ...mutation,
    star: (listId: string) => {
      const slot = nextEntrySlot(getSidebar(qc));
      if (slot) mutation.mutate({ listId, ...slot, version: 0 });
    },
    move: (listId: string, sectionId: string, position: string) => {
      const current = getSidebar(qc)?.entries.find((e) => e.listId === listId);
      mutation.mutate({ listId, sectionId, position, version: current?.version ?? 0 });
    },
  };
}

/** Removes a list from the sidebar (it stays in All lists). */
export function useUnstar() {
  return useOptimistic<string, unknown>({
    mutationKey: mutationKeys.sidebar,
    touches: () => [sidebarKey],
    apply: (qc, listId) => {
      qc.setQueryData<Sidebar>(sidebarKey, (old) => old && removeEntry(old, listId));
    },
    run: (listId) => listsApi.removeEntry(listId, uuidv7()),
    error: t("sidebar.saveError"),
  });
}

export function useCreateSection() {
  const mutation = useOptimistic<{ id: string; title: string; position: string }, unknown>({
    mutationKey: mutationKeys.sidebar,
    touches: () => [sidebarKey],
    apply: (qc, v) => {
      const section: Section = { ...v, collapsed: false, isDefault: false, version: 1 };
      qc.setQueryData<Sidebar>(sidebarKey, (old) => old && upsertSection(old, section));
    },
    run: (v) => listsApi.createSection({ clientMutationId: uuidv7(), ...v }),
    error: t("sidebar.saveError"),
  });
  return {
    ...mutation,
    create: (title: string, position: string): string => {
      const id = uuidv7();
      mutation.mutate({ id, title, position });
      return id;
    },
  };
}

export function useUpdateSection() {
  const qc = useQueryClient();
  return useOptimistic<
    { id: string; title?: string; collapsed?: boolean; position?: string },
    unknown
  >({
    mutationKey: mutationKeys.sidebar,
    touches: () => [sidebarKey],
    apply: (q, { id, ...patch }) => {
      q.setQueryData<Sidebar>(sidebarKey, (old) => {
        const current = old?.sections.find((s) => s.id === id);
        return old && current ? upsertSection(old, { ...current, ...patch }) : old;
      });
    },
    run: ({ id, ...patch }) => {
      const current = getSidebar(qc)?.sections.find((s) => s.id === id);
      return listsApi.updateSection(id, {
        clientMutationId: uuidv7(),
        baseVersion: current?.version ?? 1,
        ...patch,
      });
    },
    error: t("sidebar.saveError"),
  });
}

export function useDeleteSection() {
  return useOptimistic<string, unknown>({
    mutationKey: mutationKeys.sidebar,
    touches: () => [sidebarKey],
    apply: (qc, id) => {
      qc.setQueryData<Sidebar>(sidebarKey, (old) => old && removeSection(old, id));
    },
    run: (id) => listsApi.removeSection(id, uuidv7()),
    error: t("sidebar.saveError"),
  });
}

/** Records that the list was opened (All lists → Last opened). Fire and forget. */
export function markOpened(qc: QueryClient, id: string) {
  const now = new Date().toISOString();
  qc.setQueryData<ListIndexItem[]>(listsKey, (old) =>
    old?.map((l) => (l.id === id ? { ...l, lastOpenedAt: now } : l)),
  );
  listsApi.open(id).catch(() => undefined);
}

/**
 * Duplicate list (lists-and-blocks.md → Duplicate): the server copies the content; the copy
 * joins the index (and the sidebar, below the original, if that was starred). Resolves with
 * the copy's id, or null after a toast when it failed.
 */
export function useDuplicateList() {
  const qc = useQueryClient();
  return async (id: string): Promise<string | null> => {
    const copyId = uuidv7();
    try {
      const result = await listsApi.duplicate(id, { clientMutationId: uuidv7(), id: copyId });
      qc.setQueryData<ListIndexItem[]>(listsKey, (old) => old && upsertList(old, result.list));
      qc.setQueryData(listKey(copyId), result.list);
      const entry = result.sidebarEntry;
      if (entry) qc.setQueryData<Sidebar>(sidebarKey, (old) => old && upsertEntry(old, entry));
      toast(t("lists.duplicated"));
      return copyId;
    } catch {
      toast(t("lists.duplicateError"));
      return null;
    }
  };
}

/** Changes the caller's filter/sort settings for a list (optimistic, per user). */
export function useUpdateListPrefs(id: string) {
  return useOptimistic<UpdatePrefsVars, unknown>({
    mutationKey: mutationKeys.listPrefs(id),
    touches: () => [listPrefsKey(id)],
    apply: (qc, patch) => {
      qc.setQueryData<ListViewPrefs>(listPrefsKey(id), (old) => ({
        ...DEFAULT_LIST_VIEW_PREFS,
        ...old,
        ...patch,
      }));
    },
    run: (patch) => listsApi.updatePrefs(id, { clientMutationId: uuidv7(), ...patch }),
    error: t("lists.saveError"),
  });
}

type UpdatePrefsVars = Partial<ListViewPrefs>;
