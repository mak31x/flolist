import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id } from "./columns.ts";
import { workspaces } from "./workspaces.ts";

export const fileStatuses = ["pending", "ready"] as const;
export type FileStatus = (typeof fileStatuses)[number];

/**
 * An object in S3-compatible storage (data-model.md → Files; D-012/D-018). The row is
 * created `pending` when the API hands out a presigned PUT, and becomes `ready` once
 * the API has checked the stored object's size and leading bytes.
 */
export const files = pgTable(
  "files",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Object key in the bucket; never derived from user input. */
    storageKey: text("storage_key").notNull().unique(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    status: text("status", { enum: fileStatuses }).notNull().default("pending"),
    /** Null once the uploader's account is gone; team files outlive their uploader. */
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [
    check("files_status_check", sql`${t.status} in ('pending', 'ready')`),
    check("files_size_check", sql`${t.sizeBytes} >= 0`),
    index("files_workspace_id_idx").on(t.workspaceId),
    index("files_uploaded_by_idx").on(t.uploadedBy),
  ],
);
