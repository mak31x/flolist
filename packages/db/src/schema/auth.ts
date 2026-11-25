/**
 * Tables owned by Better Auth (D-005), hand-written to match better-auth 1.7.x:
 * core `user` and the organization plugin's `organization` and `member`.
 * The TS keys are Better Auth's field names so its Drizzle adapter maps them as-is;
 * the DB columns are snake_case. `session`, `account`, `verification` and
 * `invitation` are added in M1.1 together with the adapter.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt, version } from "./columns.ts";

export const weekStarts = ["system", "mon", "sun", "sat"] as const;
export type WeekStart = (typeof weekStarts)[number];

export const user = pgTable(
  "user",
  {
    id: id(),
    // Better Auth core fields
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Flolist profile fields (data-model.md → Identity and workspaces)
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** → files.id once the files table exists (M1.2). */
    avatarFileId: uuid("avatar_file_id"),
    timezone: text("timezone").notNull().default("UTC"),
    locale: text("locale").notNull().default("en"),
    weekStart: text("week_start", { enum: weekStarts }).notNull().default("system"),
    theme: text("theme").notNull().default("system"),
    soundsEnabled: boolean("sounds_enabled").notNull().default(true),
    autoCapitalize: boolean("auto_capitalize").notNull().default(true),
    version: version(),
  },
  (t) => [check("user_week_start_check", sql`${t.weekStart} in ('system', 'mon', 'sun', 'sat')`)],
);

/** A Better Auth organization = a Team workspace (mapped via workspaces.organization_id). */
export const organization = pgTable("organization", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: createdAt(),
});

export const memberRoles = ["owner", "member"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const member = pgTable(
  "member",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: memberRoles }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    index("member_organization_id_idx").on(t.organizationId),
    index("member_user_id_idx").on(t.userId),
    unique("member_organization_user_unique").on(t.organizationId, t.userId),
    check("member_role_check", sql`${t.role} in ('owner', 'member')`),
  ],
);
