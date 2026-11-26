import { userSettings, workspaces, type Db } from "@flolist/db";
import { sql } from "drizzle-orm";
import { ensureDefaultSection } from "../lists/dto.ts";

/**
 * Gives a user their Personal workspace, settings row and Favorites section (D-005). Idempotent: Better Auth runs
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
    await ensureDefaultSection(tx, userId);
  });
}
