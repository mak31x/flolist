import { files, user, workspaces } from "@flolist/db";
import {
  fileUrl,
  imageMimes,
  localePreferenceSchema,
  themePreferenceSchema,
  updateMeSchema,
  type Me,
} from "@flolist/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ensurePersonalWorkspace } from "../auth/personal-workspace.ts";
import { ApiException, unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { dbOf, type AppEnv } from "../types.ts";

type UserRow = typeof user.$inferSelect;

/**
 * Accounts from before M1.2 (and sign-ups, which send one `name`) have no first/last
 * name yet: split the display name at its first space until the user saves their own.
 */
export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const i = trimmed.indexOf(" ");
  if (i === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, i), lastName: trimmed.slice(i + 1).trim() };
}

function toDto(u: UserRow): Me {
  const theme = themePreferenceSchema.safeParse(u.theme);
  const locale = localePreferenceSchema.safeParse(u.locale);
  const fallback = splitName(u.name);
  return {
    id: u.id,
    name: u.name,
    firstName: u.firstName ?? fallback.firstName,
    lastName: u.lastName ?? fallback.lastName,
    email: u.email,
    emailVerified: u.emailVerified,
    avatarUrl: u.avatarFileId ? fileUrl(u.avatarFileId) : u.image,
    avatarFileId: u.avatarFileId,
    // A value the server no longer knows falls back to the default.
    theme: theme.success ? theme.data : "system",
    timezone: u.timezone,
    weekStart: u.weekStart,
    locale: locale.success ? locale.data : "system",
    version: u.version,
  };
}

/**
 * The caller's own record. Scoped to the session user (there's no other resource to
 * `authorize()`): a caller can only ever read or change themselves.
 */
export const meRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const caller = c.get("user");
    if (!caller) throw unauthenticated();
    const db = dbOf(c);
    const [row] = await db.select().from(user).where(eq(user.id, caller.id));
    if (!row) throw unauthenticated();
    // Repairs a sign-up whose after-commit hook didn't run (see ensurePersonalWorkspace).
    await ensurePersonalWorkspace(db, row.id);
    return c.json(toDto(row));
  })

  .patch("/", validate("json", updateMeSchema), async (c) => {
    const caller = c.get("user");
    if (!caller) throw unauthenticated();
    const input = c.req.valid("json");
    const db = dbOf(c);

    const [current] = await db.select().from(user).where(eq(user.id, caller.id));
    if (!current) throw unauthenticated();

    if (input.avatarFileId) {
      // Only a ready image the caller uploaded into their own personal workspace.
      const [file] = await db
        .select({ mime: files.mime })
        .from(files)
        .innerJoin(workspaces, eq(workspaces.id, files.workspaceId))
        .where(
          and(
            eq(files.id, input.avatarFileId),
            eq(files.status, "ready"),
            eq(files.uploadedBy, caller.id),
            eq(workspaces.kind, "personal"),
            eq(workspaces.ownerId, caller.id),
          ),
        );
      if (!file) throw new ApiException("NOT_FOUND", "File not found");
      if (!(imageMimes as readonly string[]).includes(file.mime)) {
        throw new ApiException("VALIDATION", "A profile photo must be an image");
      }
    }

    const names = splitName(current.name);
    const firstName = input.firstName ?? current.firstName ?? names.firstName;
    const lastName = input.lastName ?? current.lastName ?? names.lastName;
    const nameChanged = input.firstName !== undefined || input.lastName !== undefined;

    const [updated] = await db
      .update(user)
      .set({
        ...(input.theme !== undefined && { theme: input.theme }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.weekStart !== undefined && { weekStart: input.weekStart }),
        ...(input.locale !== undefined && { locale: input.locale }),
        ...(input.avatarFileId !== undefined && { avatarFileId: input.avatarFileId }),
        // Better Auth's `name` stays the display name used in emails and sessions.
        ...(nameChanged && { firstName, lastName, name: `${firstName} ${lastName}`.trim() }),
        version: sql`${user.version} + 1`,
      })
      .where(eq(user.id, caller.id))
      .returning();
    if (!updated) throw unauthenticated();
    return c.json(toDto(updated));
  });
