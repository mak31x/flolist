import { z } from "zod";
import { positionSchema } from "./positions.ts";
import { mutationMetaSchema } from "./workspaces.ts";

/** A list title; "" is allowed (a new list starts untitled and shows a placeholder). */
export const listTitleSchema = z.string().trim().max(200);
/** One emoji (possibly a multi-codepoint sequence), or null for the default icon. */
export const emojiSchema = z.string().trim().min(1).max(32).nullable();

/** A list as every viewer sees it (lists-and-blocks.md → Lists). Per-user state lives elsewhere. */
export const listSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  rootListId: z.uuid(),
  parentListId: z.uuid().nullable(),
  title: z.string(),
  emoji: z.string().nullable(),
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
  .extend({ title: listTitleSchema.optional(), emoji: emojiSchema.optional() })
  .refine((v) => v.title !== undefined || v.emoji !== undefined, {
    error: "Send at least one field to change",
  });
export type UpdateList = z.infer<typeof updateListSchema>;

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
