import { z } from "zod";
import { blockSchema } from "./blocks.ts";
import { taskSchema } from "./tasks.ts";
import { labelSchema } from "./labels.ts";
import { listSchema, listViewPrefsSchema, sectionSchema, sidebarEntrySchema } from "./lists.ts";

/**
 * Live-sync events (architecture.md → Live sync). Every mutation writes one per changed row to
 * the outbox; the API fans them out over `/ws` to the channels the row belongs to.
 *
 * Channels: `user:<id>` (the user's own rows: sections, sidebar), `workspace:<id>`, and
 * `list:<rootId>` (everyone who can see that list; joined on demand).
 */

const changeBase = {
  type: z.literal("change"),
  version: z.number().int(),
  /** The mutation that caused it, so the sending client can recognise its own echo. */
  clientMutationId: z.uuid().nullable(),
};

export const changeEventSchema = z.union([
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    entity: z.literal("list"),
    id: z.uuid(),
    data: listSchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    entity: z.literal("section"),
    id: z.uuid(),
    data: sectionSchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    entity: z.literal("sidebarEntry"),
    /** The entry's list id (one entry per user and list). */
    id: z.uuid(),
    data: sidebarEntrySchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    entity: z.literal("block"),
    id: z.uuid(),
    data: blockSchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    /** A task's own fields (the details panel); its block event carries what rows show. */
    entity: z.literal("task"),
    id: z.uuid(),
    data: taskSchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    /** The user's view settings for one list (`user:<id>` only); `version` = updatedAt in ms. */
    entity: z.literal("listPrefs"),
    /** The list id. */
    id: z.uuid(),
    data: listViewPrefsSchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("upsert"),
    /** A workspace label (`workspace:<id>`). */
    entity: z.literal("label"),
    id: z.uuid(),
    data: labelSchema,
  }),
  z.object({
    ...changeBase,
    op: z.literal("delete"),
    entity: z.enum(["list", "section", "sidebarEntry", "block", "task", "label"]),
    id: z.uuid(),
  }),
]);
export type ChangeEvent = z.infer<typeof changeEventSchema>;
export type ChangeEntity = ChangeEvent["entity"];

/** The caller's visible lists, sections or teams changed in a way a patch can't express. */
export const accessChangedEventSchema = z.object({ type: z.literal("access_changed") });

/** Messages the server sends over `/ws`. */
export const serverMessageSchema = z.union([
  changeEventSchema,
  accessChangedEventSchema,
  /** Sent once the socket's initial channels are joined. */
  z.object({ type: z.literal("ready"), channels: z.array(z.string()) }),
  z.object({ type: z.literal("subscribed"), channel: z.string() }),
  z.object({ type: z.literal("error"), message: z.string(), channel: z.string().optional() }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

const listChannelSchema = z.string().regex(/^list:[0-9a-f-]{36}$/i);

/** Messages a client sends over `/ws`. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), channel: listChannelSchema }),
  z.object({ type: z.literal("unsubscribe"), channel: listChannelSchema }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const channel = {
  user: (id: string) => `user:${id}`,
  workspace: (id: string) => `workspace:${id}`,
  list: (rootId: string) => `list:${rootId}`,
} as const;
