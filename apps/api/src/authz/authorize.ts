import { member, workspaces, type Db } from "@flolist/db";
import { decide, type Action, type WorkspaceRole, type WorkspaceSubject } from "@flolist/shared";
import { and, eq, isNull } from "drizzle-orm";
import { forbidden, notFound, unauthenticated } from "../lib/errors.ts";
import type { AuthUser } from "../types.ts";

export type Resource = { type: "workspace"; id: string };

export type WorkspaceRow = typeof workspaces.$inferSelect;

export interface Authorized {
  user: AuthUser;
  workspace: WorkspaceRow;
  role: WorkspaceRole;
}

/**
 * The single access gate (architecture.md → Authorization). Every handler that touches
 * a resource calls it with the resource id from the URL, never with ids it trusts from
 * the client. It loads the caller's relationship to the resource from the database and
 * checks it against the shared matrix:
 * - no user                      → UNAUTHENTICATED
 * - can't see it (or it's gone)  → NOT_FOUND, so ids of other people's data don't leak
 * - can see it, action not allowed → FORBIDDEN
 */
export async function authorize(
  db: Db,
  user: AuthUser | null,
  action: Action,
  resource: Resource,
): Promise<Authorized> {
  if (!user) throw unauthenticated();

  const [row] = await db
    .select({ workspace: workspaces, memberRole: member.role })
    .from(workspaces)
    .leftJoin(
      member,
      and(eq(member.organizationId, workspaces.organizationId), eq(member.userId, user.id)),
    )
    .where(and(eq(workspaces.id, resource.id), isNull(workspaces.deletedAt)))
    .limit(1);

  const role = row ? workspaceRole(row.workspace, row.memberRole, user.id) : null;
  const subject: WorkspaceSubject = {
    type: "workspace",
    kind: row?.workspace.kind ?? "personal",
    role,
  };

  const decision = decide(action, subject);
  if (decision === "not_found" || !row || !role) throw notFound("Workspace");
  if (decision === "forbidden") throw forbidden();
  return { user, workspace: row.workspace, role };
}

function workspaceRole(
  ws: WorkspaceRow,
  memberRole: WorkspaceRole | null,
  userId: string,
): WorkspaceRole | null {
  if (ws.kind === "personal") return ws.ownerId === userId ? "owner" : null;
  return memberRole;
}
