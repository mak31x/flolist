/**
 * Pure role → capability matrix, used by the API's `authorize()` and by the web app
 * to show or hide UI. Grows with each phase: lists/blocks/tasks are added in M2–M3,
 * sharing in M7 (data-model.md → Access resolution).
 *
 * Resolution rule shared by every caller:
 * - no role on the resource  → the resource is invisible (API answers NOT_FOUND)
 * - a role, but not allowed  → FORBIDDEN
 */

export const workspaceActions = [
  "workspace.view",
  "workspace.update",
  "workspace.delete",
  "workspace.manageMembers",
] as const;
export type WorkspaceAction = (typeof workspaceActions)[number];

export type Action = WorkspaceAction;

export type WorkspaceRole = "owner" | "member";
export type WorkspaceKind = "personal" | "team";

/** What the caller is to one workspace; `role: null` means "not a member". */
export interface WorkspaceSubject {
  type: "workspace";
  kind: WorkspaceKind;
  role: WorkspaceRole | null;
}

export type Subject = WorkspaceSubject;

type Matrix = Record<WorkspaceKind, Record<WorkspaceRole, readonly WorkspaceAction[]>>;

/**
 * Personal workspaces have exactly one member (the owner) and can't be deleted or shared.
 * In a team, members can see it; only the owner manages it [assumption] (collaboration.md §2
 * refines member capabilities in M7.1).
 */
const workspaceMatrix: Matrix = {
  personal: {
    owner: ["workspace.view", "workspace.update"],
    member: [],
  },
  team: {
    owner: ["workspace.view", "workspace.update", "workspace.delete", "workspace.manageMembers"],
    member: ["workspace.view"],
  },
};

/** Whether the subject can see the resource at all. */
export function canSee(subject: Subject): boolean {
  return subject.role !== null && can("workspace.view", subject);
}

export function can(action: Action, subject: Subject): boolean {
  if (subject.role === null) return false;
  return workspaceMatrix[subject.kind][subject.role].includes(action);
}

export type Decision = "allow" | "forbidden" | "not_found";

/** `can` plus the NOT_FOUND/FORBIDDEN split the API needs. */
export function decide(action: Action, subject: Subject): Decision {
  if (!canSee(subject)) return "not_found";
  return can(action, subject) ? "allow" : "forbidden";
}

export * from "./permissions.fixtures.ts";
