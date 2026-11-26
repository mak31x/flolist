import { lists, member, sections, workspaces, type Executor } from "@flolist/db";
import {
  decide,
  type Decision,
  type ListAction,
  type SectionAction,
  type WorkspaceAction,
  type WorkspaceRole,
  type WorkspaceSubject,
} from "@flolist/shared";
import { and, eq, isNull } from "drizzle-orm";
import { forbidden, notFound, unauthenticated } from "../lib/errors.ts";
import type { AuthUser } from "../types.ts";

export type Resource =
  | { type: "workspace"; id: string }
  | { type: "list"; id: string }
  | { type: "section"; id: string };

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type ListRow = typeof lists.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;

export interface Authorized {
  user: AuthUser;
  workspace: WorkspaceRow;
  role: WorkspaceRole;
}
export interface AuthorizedList {
  user: AuthUser;
  list: ListRow;
  /** The list's root (equal to `list` for root lists): access and channels resolve through it. */
  root: ListRow;
}
export interface AuthorizedSection {
  user: AuthUser;
  section: SectionRow;
}

/**
 * The single access gate (architecture.md → Authorization). Every handler that touches
 * a resource calls it with the resource id from the URL, never with ids it trusts from
 * the client. It loads the caller's relationship to the resource from the database and
 * checks it against the shared matrix:
 * - no user                      → UNAUTHENTICATED
 * - can't see it (or it's gone)  → NOT_FOUND, so ids of other people's data don't leak
 * - can see it, action not allowed → FORBIDDEN
 *
 * Pass the mutation's `tx` so the check and the write see the same rows.
 */
export async function authorize(
  db: Executor,
  user: AuthUser | null,
  action: WorkspaceAction,
  resource: { type: "workspace"; id: string },
): Promise<Authorized>;
export async function authorize(
  db: Executor,
  user: AuthUser | null,
  action: ListAction,
  resource: { type: "list"; id: string },
): Promise<AuthorizedList>;
export async function authorize(
  db: Executor,
  user: AuthUser | null,
  action: SectionAction,
  resource: { type: "section"; id: string },
): Promise<AuthorizedSection>;
export async function authorize(
  db: Executor,
  user: AuthUser | null,
  action: WorkspaceAction | ListAction | SectionAction,
  resource: Resource,
): Promise<Authorized | AuthorizedList | AuthorizedSection> {
  if (!user) throw unauthenticated();
  switch (resource.type) {
    case "workspace":
      return authorizeWorkspace(db, user, action as WorkspaceAction, resource.id);
    case "list":
      return authorizeList(db, user, action as ListAction, resource.id);
    case "section":
      return authorizeSection(db, user, action as SectionAction, resource.id);
  }
}

function enforce(decision: Decision, what: string): void {
  if (decision === "not_found") throw notFound(what);
  if (decision === "forbidden") throw forbidden();
}

async function authorizeWorkspace(
  db: Executor,
  user: AuthUser,
  action: WorkspaceAction,
  id: string,
): Promise<Authorized> {
  const [row] = await db
    .select({ workspace: workspaces, memberRole: member.role })
    .from(workspaces)
    .leftJoin(
      member,
      and(eq(member.organizationId, workspaces.organizationId), eq(member.userId, user.id)),
    )
    .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
    .limit(1);

  const role = row ? workspaceRole(row.workspace, row.memberRole, user.id) : null;
  const subject: WorkspaceSubject = {
    type: "workspace",
    kind: row?.workspace.kind ?? "personal",
    role,
  };

  enforce(decide(action, subject), "Workspace");
  if (!row || !role) throw notFound("Workspace");
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

/**
 * canSeeList (data-model.md → Access resolution), resolved through the root list. Until
 * sharing (M7.2) the only role is the root's creator. A soft-deleted list (or root) is gone.
 */
async function authorizeList(
  db: Executor,
  user: AuthUser,
  action: ListAction,
  id: string,
): Promise<AuthorizedList> {
  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, id), isNull(lists.deletedAt)))
    .limit(1);
  let root = list;
  if (list && list.rootListId !== list.id) {
    [root] = await db
      .select()
      .from(lists)
      .where(and(eq(lists.id, list.rootListId), isNull(lists.deletedAt)))
      .limit(1);
  }
  const role = root?.createdBy === user.id ? "creator" : null;
  enforce(decide(action, { type: "list", role }), "List");
  if (!list || !root) throw notFound("List");
  return { user, list, root };
}

async function authorizeSection(
  db: Executor,
  user: AuthUser,
  action: SectionAction,
  id: string,
): Promise<AuthorizedSection> {
  const [section] = await db.select().from(sections).where(eq(sections.id, id)).limit(1);
  const role = section?.userId === user.id ? "owner" : null;
  enforce(
    decide(action, { type: "section", role, isDefault: section?.isDefault ?? false }),
    "Section",
  );
  if (!section) throw notFound("Section");
  return { user, section };
}
