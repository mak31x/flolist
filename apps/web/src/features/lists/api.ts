import {
  createListResultSchema,
  listIndexItemSchema,
  listIndexSchema,
  sectionSchema,
  sidebarEntrySchema,
  sidebarSchema,
  type CreateList,
  type ListIndexItem,
  type PutSidebarEntry,
  type Sidebar,
  type UpdateList,
  type UpdateSection,
} from "@flolist/shared";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { api, ApiRequestError } from "../../lib/api.ts";

export const listsKey = ["lists"] as const;
export const sidebarKey = ["sidebar"] as const;
export const listKey = (id: string) => ["list", id] as const;

/** The caller's list index, newest first (All lists, sidebar titles). */
export const listsQuery = queryOptions({
  queryKey: listsKey,
  queryFn: async (): Promise<ListIndexItem[]> =>
    (await api("GET", "/lists", listIndexSchema)).items,
  staleTime: 60_000,
});

/** Sections and starred entries, each sorted by position. */
export const sidebarQuery = queryOptions({
  queryKey: sidebarKey,
  queryFn: (): Promise<Sidebar> => api("GET", "/sidebar", sidebarSchema),
  staleTime: 60_000,
});

/** One list; `null` once it's gone (deleted, or never visible to the caller). */
export const listQuery = (id: string) =>
  queryOptions({
    queryKey: listKey(id),
    queryFn: async (): Promise<ListIndexItem | null> => {
      try {
        return await api("GET", `/lists/${id}`, listIndexItemSchema);
      } catch (err) {
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 400)) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 60_000,
  });

const ok = z.unknown();

export const listsApi = {
  create: (input: CreateList) => api("POST", "/lists", createListResultSchema, input),
  update: (id: string, input: UpdateList) =>
    api("PATCH", `/lists/${id}`, listIndexItemSchema, input),
  remove: (id: string, clientMutationId: string) =>
    api("DELETE", `/lists/${id}`, ok, { clientMutationId }),
  open: (id: string) => api("POST", `/lists/${id}/open`),
  putEntry: (listId: string, input: PutSidebarEntry) =>
    api("PUT", `/sidebar/entries/${listId}`, sidebarEntrySchema, input),
  removeEntry: (listId: string, clientMutationId: string) =>
    api("DELETE", `/sidebar/entries/${listId}`, ok, { clientMutationId }),
  createSection: (input: {
    clientMutationId: string;
    id: string;
    title: string;
    position: string;
  }) => api("POST", "/sections", sectionSchema, input),
  updateSection: (id: string, input: UpdateSection) =>
    api("PATCH", `/sections/${id}`, sectionSchema, input),
  removeSection: (id: string, clientMutationId: string) =>
    api("DELETE", `/sections/${id}`, ok, { clientMutationId }),
};
