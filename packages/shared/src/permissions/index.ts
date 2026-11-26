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
  /** Upload a file into the workspace (D-037). Viewing files uses `workspace.view`. */
  "workspace.uploadFile",
  /** Create a list owned by this workspace (lists-and-blocks.md → Lists). */
  "workspace.createList",
] as const;
export type WorkspaceAction = (typeof workspaceActions)[number];

/** `manage` = move between workspaces and delete (data-model.md → canManageList). */
export const listActions = ["list.view", "list.edit", "list.manage"] as const;
export type ListAction = (typeof listActions)[number];

/** Sidebar sections are private to their user. */
export const sectionActions = ["section.view", "section.update", "section.delete"] as const;
export type SectionAction = (typeof sectionActions)[number];

export type Action = WorkspaceAction | ListAction | SectionAction;

export type WorkspaceRole = "owner" | "member";
export type WorkspaceKind = "personal" | "team";

/** What the caller is to one workspace; `role: null` means "not a member". */
export interface WorkspaceSubject {
  type: "workspace";
  kind: WorkspaceKind;
  role: WorkspaceRole | null;
}

/**
 * What the caller is to one list (resolved through its root). Only the creator exists until
 * sharing (M7.2) adds collaborator, viewer and the owning team's owner.
 */
export type ListRole = "creator";
export interface ListSubject {
  type: "list";
  role: ListRole | null;
}

export interface SectionSubject {
  type: "section";
  role: "owner" | null;
  /** The "Favorites" section can't be deleted [assumption]. */
  isDefault: boolean;
}

export type Subject = WorkspaceSubject | ListSubject | SectionSubject;

type Matrix = Record<WorkspaceKind, Record<WorkspaceRole, readonly WorkspaceAction[]>>;

/**
 * Personal workspaces have exactly one member (the owner) and can't be deleted or shared.
 * In a team, members can see it; only the owner manages it [assumption] (collaboration.md §2
 * refines member capabilities in M7.1).
 */
const workspaceMatrix: Matrix = {
  personal: {
    owner: ["workspace.view", "workspace.update", "workspace.uploadFile", "workspace.createList"],
    member: [],
  },
  team: {
    owner: [
      "workspace.view",
      "workspace.update",
      "workspace.delete",
      "workspace.manageMembers",
      "workspace.uploadFile",
      "workspace.createList",
    ],
    member: ["workspace.view", "workspace.uploadFile", "workspace.createList"],
  },
};

const listMatrix: Record<ListRole, readonly ListAction[]> = {
  creator: ["list.view", "list.edit", "list.manage"],
};

/** Whether the subject can see the resource at all. */
export function canSee(subject: Subject): boolean {
  if (subject.role === null) return false;
  switch (subject.type) {
    case "workspace":
      return can("workspace.view", subject);
    case "list":
      return can("list.view", subject);
    case "section":
      return true;
  }
}

export function can(action: Action, subject: Subject): boolean {
  if (subject.role === null) return false;
  switch (subject.type) {
    case "workspace":
      return (workspaceMatrix[subject.kind][subject.role] as readonly Action[]).includes(action);
    case "list":
      return (listMatrix[subject.role] as readonly Action[]).includes(action);
    case "section":
      if (action === "section.delete") return !subject.isDefault;
      return (sectionActions as readonly Action[]).includes(action);
  }
}

export type Decision = "allow" | "forbidden" | "not_found";

/** `can` plus the NOT_FOUND/FORBIDDEN split the API needs. */
export function decide(action: Action, subject: Subject): Decision {
  if (!canSee(subject)) return "not_found";
  return can(action, subject) ? "allow" : "forbidden";
}

export * from "./permissions.fixtures.ts";
