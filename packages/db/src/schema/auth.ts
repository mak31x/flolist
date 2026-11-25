/**
 * Tables owned by Better Auth (D-005), hand-written to match better-auth 1.7.28
 * (field lists read from `@better-auth/core` db/get-tables and the organization
 * plugin; D-022): core `user`, `session`, `account`, `verification`, and the
 * organization plugin's `organization`, `member` and `invitation` (teams off).
 * The TS keys are Better Auth's field names so its Drizzle adapter maps them as-is;
 * the DB columns are snake_case.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt, version } from "./columns.ts";
import { files } from "./files.ts";

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
    avatarFileId: uuid("avatar_file_id").references((): AnyPgColumn => files.id, {
      onDelete: "set null",
    }),
    timezone: text("timezone").notNull().default("UTC"),
    locale: text("locale").notNull().default("system"),
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

const expiresAt = () => timestamp("expires_at", { withTimezone: true }).notNull();

/** Login session; the organization plugin adds `activeOrganizationId`. */
export const session = pgTable(
  "session",
  {
    id: id(),
    expiresAt: expiresAt(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

/** A login method: `credential` (password hash) or an OAuth provider such as `google`. */
export const account = pgTable(
  "account",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    unique("account_provider_account_unique").on(t.providerId, t.accountId),
  ],
);

/** Email-verification and password-reset tokens. */
export const verification = pgTable(
  "verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: expiresAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const invitationStatuses = ["pending", "accepted", "rejected", "canceled"] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];

/** Team invitation (organization plugin); accepted in M7.1. */
export const invitation = pgTable(
  "invitation",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: memberRoles }),
    status: text("status", { enum: invitationStatuses }).notNull().default("pending"),
    expiresAt: expiresAt(),
    createdAt: createdAt(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("invitation_organization_id_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
    check("invitation_role_check", sql`${t.role} in ('owner', 'member')`),
    check(
      "invitation_status_check",
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
  ],
);
