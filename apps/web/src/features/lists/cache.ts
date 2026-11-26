import {
  byPosition,
  compareKeys,
  type List,
  type ListIndexItem,
  type Section,
  type Sidebar,
  type SidebarEntry,
} from "@flolist/shared";

/**
 * Pure cache updaters shared by optimistic mutations and live-sync `applyChange`. Each returns
 * a new value and never mutates its input.
 */

const newestFirst = (a: ListIndexItem, b: ListIndexItem) =>
  compareKeys(b.createdAt, a.createdAt) || compareKeys(b.id, a.id);

/** Inserts or replaces a list, keeping the caller's own `lastOpenedAt`. */
export function upsertList(items: readonly ListIndexItem[], list: List | ListIndexItem) {
  const existing = items.find((l) => l.id === list.id);
  const lastOpenedAt =
    "lastOpenedAt" in list ? list.lastOpenedAt : (existing?.lastOpenedAt ?? null);
  const next: ListIndexItem = { ...list, lastOpenedAt };
  const rest = items.filter((l) => l.id !== list.id);
  // Sublists are in the index too (breadcrumbs, starring); All lists shows roots only.
  return [...rest, next].sort(newestFirst);
}

export const removeList = (items: readonly ListIndexItem[], id: string) =>
  items.filter((l) => l.id !== id);

export const patchList = (
  items: readonly ListIndexItem[],
  id: string,
  patch: Partial<Pick<List, "title" | "emoji" | "cover">>,
) => items.map((l) => (l.id === id ? { ...l, ...patch } : l));

const entryOrder = (a: SidebarEntry, b: SidebarEntry) =>
  byPosition({ position: a.position, id: a.listId }, { position: b.position, id: b.listId });

export function upsertSection(sidebar: Sidebar, section: Section): Sidebar {
  const sections = [...sidebar.sections.filter((s) => s.id !== section.id), section].sort(
    byPosition,
  );
  return { ...sidebar, sections };
}

/** Removes a section and, like the server, unpins its lists. */
export function removeSection(sidebar: Sidebar, id: string): Sidebar {
  return {
    sections: sidebar.sections.filter((s) => s.id !== id),
    entries: sidebar.entries.filter((e) => e.sectionId !== id),
  };
}

export function upsertEntry(sidebar: Sidebar, entry: SidebarEntry): Sidebar {
  const entries = [...sidebar.entries.filter((e) => e.listId !== entry.listId), entry].sort(
    entryOrder,
  );
  return { ...sidebar, entries };
}

export function removeEntry(sidebar: Sidebar, listId: string): Sidebar {
  return { ...sidebar, entries: sidebar.entries.filter((e) => e.listId !== listId) };
}

/** Entries of one section, in order. */
export const entriesOf = (sidebar: Sidebar, sectionId: string) =>
  sidebar.entries.filter((e) => e.sectionId === sectionId);

export const defaultSection = (sidebar: Sidebar) => sidebar.sections.find((s) => s.isDefault);
