import { userSettings, workspaces, type Db } from "@flolist/db";
import { and, eq, sql } from "drizzle-orm";
import { ensureDefaultSection } from "../lists/dto.ts";
import { seedGettingStarted } from "./getting-started.ts";

/**
 * Gives a user their Personal workspace, settings row, Favorites section (D-005) and the
 * "Getting started" list (seeded once, D-057). Idempotent: Better Auth runs
 * `user.create.after` only after its transaction commits, so a crash in between could leave a
 * user without one; `/api/v1/me` calls this again to repair that.
 */
export async function ensurePersonalWorkspace(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(workspaces)
      .values({ kind: "personal", name: "Personal", ownerId: userId })
      .onConflictDoNothing({
        target: workspaces.ownerId,
        where: sql`${workspaces.kind} = 'personal'`,
      });
    await tx.insert(userSettings).values({ userId }).onConflictDoNothing();
    const section = await ensureDefaultSection(tx, userId);
    const [personal] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.ownerId, userId), eq(workspaces.kind, "personal")));
    if (personal) await seedGettingStarted(tx, userId, personal.id, section);
  });
}
