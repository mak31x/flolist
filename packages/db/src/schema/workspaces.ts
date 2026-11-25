import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { createdAt, id, updatedAt, version } from "./columns.ts";

export const workspaceKinds = ["personal", "team"] as const;
export type WorkspaceKind = (typeof workspaceKinds)[number];

/**
 * Personal or Team workspace (D-016). Team workspaces map 1:1 to a Better Auth
 * organization; membership lives in `member`. A personal workspace has no
 * organization and its only member is `owner_id`.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    kind: text("kind", { enum: workspaceKinds }).notNull(),
    name: text("name").notNull(),
    emoji: text("emoji"),
    /** → files.id once the files table exists (M1.2). */
    avatarFileId: uuid("avatar_file_id"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("workspaces_kind_check", sql`${t.kind} in ('personal', 'team')`),
    check(
      "workspaces_kind_organization_check",
      sql`(${t.kind} = 'team') = (${t.organizationId} is not null)`,
    ),
    uniqueIndex("workspaces_organization_id_unique").on(t.organizationId),
    // Exactly one personal workspace per user.
    uniqueIndex("workspaces_personal_owner_unique")
      .on(t.ownerId)
      .where(sql`${t.kind} = 'personal'`),
    index("workspaces_owner_id_idx").on(t.ownerId),
  ],
);

export const digestFrequencies = ["off", "weekly", "monthly"] as const;
export type DigestFrequency = (typeof digestFrequencies)[number];

export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `{ [workspaceId]: visible }`; missing keys count as visible. */
    workspaceVisibility: jsonb("workspace_visibility")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    hiddenCollaborators: uuid("hidden_collaborators")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    notificationPrefs: jsonb("notification_prefs")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    dailyPlanningTime: time("daily_planning_time"),
    digest: text("digest", { enum: digestFrequencies }).notNull().default("off"),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [check("user_settings_digest_check", sql`${t.digest} in ('off', 'weekly', 'monthly')`)],
);
