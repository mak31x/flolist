import { z } from "zod";
import { positionSchema } from "./positions.ts";
import { mutationMetaSchema } from "./workspaces.ts";

/** A list title; "" is allowed (a new list starts untitled and shows a placeholder). */
export const listTitleSchema = z.string().trim().max(200);
/** One emoji (possibly a multi-codepoint sequence), or null for the default icon. */
export const emojiSchema = z.string().trim().min(1).max(32).nullable();

/** Built-in cover images (D-028); the web app maps each id to its file in `public/covers`. */
export const BUILTIN_COVERS = [
  "misty-mountains",
  "pastel-ocean",
  "misty-marsh",
  "forest-river",
  "still-rock",
  "mountain-lake",
  "dawn-river",
  "wooden-dock",
] as const;
export const builtinCoverSchema = z.enum(BUILTIN_COVERS);
export type BuiltinCover = z.infer<typeof builtinCoverSchema>;

/** A list's cover: a built-in image, an uploaded image file, or none. */
export const listCoverSchema = z
  .union([z.strictObject({ builtin: builtinCoverSchema }), z.strictObject({ fileId: z.uuid() })])
  .nullable();
export type ListCover = z.infer<typeof listCoverSchema>;

/** A list as every viewer sees it (lists-and-blocks.md → Lists). Per-user state lives elsewhere. */
export const listSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  rootListId: z.uuid(),
  parentListId: z.uuid().nullable(),
  /** The sublist block that holds this list (sublists only). */
  parentBlockId: z.uuid().nullable(),
  title: z.string(),
  emoji: z.string().nullable(),
  cover: listCoverSchema,
  createdBy: z.uuid(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type List = z.infer<typeof listSchema>;

/** A list plus the caller's own state for it, as `GET /lists` returns it. */
export const listIndexItemSchema = listSchema.extend({
  lastOpenedAt: z.iso.datetime().nullable(),
});
export type ListIndexItem = z.infer<typeof listIndexItemSchema>;

export const listIndexSchema = z.object({ items: z.array(listIndexItemSchema) });
export type ListIndex = z.infer<typeof listIndexSchema>;

export const idParamSchema = z.object({ id: z.uuid() });
export const listIdParamSchema = z.object({ listId: z.uuid() });

/** Only the mutation id, for creates and deletes that have no base version. */
export const clientMutationSchema = z.object({ clientMutationId: z.uuid() });

export const createListSchema = clientMutationSchema.extend({
  /** Client-generated UUIDv7 (D-006). */
  id: z.uuid(),
  title: listTitleSchema.default(""),
  emoji: emojiSchema.optional(),
  /** Defaults to the caller's Personal workspace. */
  workspaceId: z.uuid().optional(),
  /**
   * Where the new list is starred (new lists go to Favorites; lists-and-blocks.md). Omit both
   * to append it to Favorites; the client sends them when it already placed it optimistically.
   */
  sectionId: z.uuid().optional(),
  position: positionSchema.optional(),
});
export type CreateList = z.input<typeof createListSchema>;

export const updateListSchema = mutationMetaSchema
  .extend({
    title: listTitleSchema.optional(),
    emoji: emojiSchema.optional(),
    /** An uploaded cover must be a ready image in the list's workspace. */
    cover: listCoverSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.emoji !== undefined || v.cover !== undefined, {
    error: "Send at least one field to change",
  });
export type UpdateList = z.infer<typeof updateListSchema>;

/** `POST /lists/:id/duplicate`: the copy's id is client-made, like any new list (D-006). */
export const duplicateListSchema = clientMutationSchema.extend({ id: z.uuid() });
export type DuplicateList = z.infer<typeof duplicateListSchema>;

/** `POST /lists/:id/duplicate` answers like a create; `sidebarEntry` is null if not starred. */
export const duplicateListResultSchema = z.object({
  list: z.lazy(() => listIndexItemSchema),
  sidebarEntry: z.lazy(() => sidebarEntrySchema).nullable(),
});

// Per-user view settings (lists-and-blocks.md → Filter/sort menu).

export const LIST_SORTS = [
  "manual",
  "creator",
  "assignee",
  "alphabetical",
  "priority",
  "created",
  "due",
  "source",
  "label",
  "completed",
] as const;
export const listSortSchema = z.enum(LIST_SORTS);
export type ListSort = z.infer<typeof listSortSchema>;

/**
 * Sorts the menu offers so far. Priority, Due date and Label come with M3.2, Assignee with M7.3
 * and Source with the integrations (M9).
 */
export const AVAILABLE_LIST_SORTS = [
  "manual",
  "creator",
  "alphabetical",
  "created",
  "completed",
] as const satisfies readonly ListSort[];

export const listViewPrefsSchema = z.object({
  sort: listSortSchema,
  hideCompleted: z.boolean(),
  tasksOnly: z.boolean(),
});
export type ListViewPrefs = z.infer<typeof listViewPrefsSchema>;

export const DEFAULT_LIST_VIEW_PREFS: ListViewPrefs = {
  sort: "manual",
  hideCompleted: false,
  tasksOnly: false,
};

/** `PATCH /lists/:id/prefs`: per user, so no version; only the sent fields change. */
export const updateListViewPrefsSchema = clientMutationSchema
  .extend(listViewPrefsSchema.partial().shape)
  .refine(
    (v) => v.sort !== undefined || v.hideCompleted !== undefined || v.tasksOnly !== undefined,
    {
      error: "Send at least one field to change",
    },
  );
export type UpdateListViewPrefs = z.infer<typeof updateListViewPrefsSchema>;

// Sidebar: sections and starred entries (per user).

export const sectionTitleSchema = z.string().trim().min(1).max(100);

export const sectionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  position: z.string(),
  collapsed: z.boolean(),
  isDefault: z.boolean(),
  version: z.number().int(),
});
export type Section = z.infer<typeof sectionSchema>;

export const sidebarEntrySchema = z.object({
  listId: z.uuid(),
  sectionId: z.uuid(),
  position: z.string(),
  version: z.number().int(),
});
export type SidebarEntry = z.infer<typeof sidebarEntrySchema>;

/** `GET /sidebar`: sections and entries, each sorted by position. */
export const sidebarSchema = z.object({
  sections: z.array(sectionSchema),
  entries: z.array(sidebarEntrySchema),
});
export type Sidebar = z.infer<typeof sidebarSchema>;

export const createSectionSchema = clientMutationSchema.extend({
  id: z.uuid(),
  title: sectionTitleSchema,
  position: positionSchema,
});
export type CreateSection = z.infer<typeof createSectionSchema>;

export const updateSectionSchema = mutationMetaSchema
  .extend({
    title: sectionTitleSchema.optional(),
    collapsed: z.boolean().optional(),
    position: positionSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.collapsed !== undefined || v.position !== undefined, {
    error: "Send at least one field to change",
  });
export type UpdateSection = z.infer<typeof updateSectionSchema>;

/** Star a list into a section, or move an entry (`PUT /sidebar/entries/:listId`). */
export const putSidebarEntrySchema = clientMutationSchema.extend({
  sectionId: z.uuid(),
  position: positionSchema,
});
export type PutSidebarEntry = z.infer<typeof putSidebarEntrySchema>;

export const DEFAULT_SECTION_TITLE = "Favorites";

/** `POST /lists` answers with the list and where it was starred. */
export const createListResultSchema = z.object({
  list: listIndexItemSchema,
  sidebarEntry: sidebarEntrySchema,
});
export type CreateListResult = z.infer<typeof createListResultSchema>;
export type DuplicateListResult = z.infer<typeof duplicateListResultSchema>;
