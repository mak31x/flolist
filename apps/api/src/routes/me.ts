import { user } from "@flolist/db";
import { themePreferenceSchema, updateMeSchema, type Me } from "@flolist/shared";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { ensurePersonalWorkspace } from "../auth/personal-workspace.ts";
import { unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { dbOf, type AppEnv } from "../types.ts";

type UserRow = typeof user.$inferSelect;

function toDto(u: UserRow): Me {
  const theme = themePreferenceSchema.safeParse(u.theme);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    image: u.image,
    // A theme the server no longer knows falls back to System.
    theme: theme.success ? theme.data : "system",
    timezone: u.timezone,
    weekStart: u.weekStart,
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
    const [updated] = await dbOf(c)
      .update(user)
      .set({ theme: input.theme, version: sql`${user.version} + 1` })
      .where(eq(user.id, caller.id))
      .returning();
    if (!updated) throw unauthenticated();
    return c.json(toDto(updated));
  });
