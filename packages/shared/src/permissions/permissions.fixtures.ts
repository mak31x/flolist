/**
 * Permission fixtures: `(setup, action, resource) → expected`.
 *
 * Every case is data, not code, so it can be checked three ways:
 * - the pure matrix (`decide`) in packages/shared,
 * - the API integration tests, which build `setup` in a real database and call the route,
 * - UI-gating tests (from M0.3 on).
 *
 * `setup` describes the world from the actor's point of view; the test harness turns it
 * into rows (a workspace of `kind`, the actor with `actorRole`, or not a member at all).
 * Add a case whenever an action or rule is added. Cases must stay unique by `name`.
 */
import type {
  Action,
  Decision,
  ListAction,
  ListRole,
  SectionAction,
  TaskAction,
  TaskRole,
  WorkspaceAction,
  WorkspaceKind,
  WorkspaceRole,
} from "./index.ts";

export interface WorkspaceFixtureSetup {
  workspace: { kind: WorkspaceKind; deleted?: boolean };
  /** `"none"` = the actor isn't a member. */
  actorRole: WorkspaceRole | "none";
}

export interface PermissionFixture {
  name: string;
  setup: WorkspaceFixtureSetup;
  action: WorkspaceAction;
  resource: { type: "workspace" };
  expected: Decision;
}

const ws = (
  name: string,
  kind: WorkspaceKind,
  actorRole: WorkspaceRole | "none",
  action: WorkspaceAction,
  expected: Decision,
  extra: { deleted?: boolean } = {},
): PermissionFixture => ({
  name,
  setup: { workspace: { kind, ...extra }, actorRole },
  action,
  resource: { type: "workspace" },
  expected,
});

export const permissionFixtures: readonly PermissionFixture[] = [
  // Personal workspace: only its owner, and it can't be deleted or get members.
  ws("personal owner views", "personal", "owner", "workspace.view", "allow"),
  ws("personal owner renames", "personal", "owner", "workspace.update", "allow"),
  ws("personal owner can't delete", "personal", "owner", "workspace.delete", "forbidden"),
  ws("personal has no members", "personal", "owner", "workspace.manageMembers", "forbidden"),
  ws("personal owner uploads files", "personal", "owner", "workspace.uploadFile", "allow"),
  ws(
    "stranger can't upload into a personal ws",
    "personal",
    "none",
    "workspace.uploadFile",
    "not_found",
  ),
  ws("stranger can't see a personal ws", "personal", "none", "workspace.view", "not_found"),
  ws("stranger can't rename a personal ws", "personal", "none", "workspace.update", "not_found"),
  ws("stranger can't delete a personal ws", "personal", "none", "workspace.delete", "not_found"),
  ws(
    "stranger can't add members to a personal ws",
    "personal",
    "none",
    "workspace.manageMembers",
    "not_found",
  ),

  // Team workspace.
  ws("team owner views", "team", "owner", "workspace.view", "allow"),
  ws("team owner renames", "team", "owner", "workspace.update", "allow"),
  ws("team owner deletes", "team", "owner", "workspace.delete", "allow"),
  ws("team owner manages members", "team", "owner", "workspace.manageMembers", "allow"),
  ws("team member views", "team", "member", "workspace.view", "allow"),
  ws("team member can't rename", "team", "member", "workspace.update", "forbidden"),
  ws("team member can't delete", "team", "member", "workspace.delete", "forbidden"),
  ws("team member can't manage members", "team", "member", "workspace.manageMembers", "forbidden"),
  ws("team owner uploads files", "team", "owner", "workspace.uploadFile", "allow"),
  ws("team member uploads files", "team", "member", "workspace.uploadFile", "allow"),
  ws("non-member can't upload into a team", "team", "none", "workspace.uploadFile", "not_found"),
  ws("personal owner creates lists", "personal", "owner", "workspace.createList", "allow"),
  ws(
    "stranger can't create lists in a personal ws",
    "personal",
    "none",
    "workspace.createList",
    "not_found",
  ),
  ws("team owner creates lists", "team", "owner", "workspace.createList", "allow"),
  ws("team member creates lists", "team", "member", "workspace.createList", "allow"),
  ws(
    "non-member can't create lists in a team",
    "team",
    "none",
    "workspace.createList",
    "not_found",
  ),
  // Inbox tasks (M4.1).
  ws("personal owner creates inbox tasks", "personal", "owner", "workspace.createTask", "allow"),
  ws(
    "stranger can't create tasks in a personal ws",
    "personal",
    "none",
    "workspace.createTask",
    "not_found",
  ),
  ws("team owner creates inbox tasks", "team", "owner", "workspace.createTask", "allow"),
  ws("team member creates inbox tasks", "team", "member", "workspace.createTask", "allow"),
  ws(
    "non-member can't create tasks in a team",
    "team",
    "none",
    "workspace.createTask",
    "not_found",
  ),
  // Labels (M3.2).
  ws("personal owner uses labels", "personal", "owner", "workspace.useLabels", "allow"),
  ws("personal owner manages labels", "personal", "owner", "workspace.manageLabels", "allow"),
  ws("stranger can't use personal labels", "personal", "none", "workspace.useLabels", "not_found"),
  ws(
    "stranger can't manage personal labels",
    "personal",
    "none",
    "workspace.manageLabels",
    "not_found",
  ),
  ws("team owner uses labels", "team", "owner", "workspace.useLabels", "allow"),
  ws("team owner manages labels", "team", "owner", "workspace.manageLabels", "allow"),
  ws("team member uses labels", "team", "member", "workspace.useLabels", "allow"),
  ws("team member manages labels", "team", "member", "workspace.manageLabels", "allow"),
  ws("non-member can't use team labels", "team", "none", "workspace.useLabels", "not_found"),
  ws("non-member can't manage team labels", "team", "none", "workspace.manageLabels", "not_found"),
  ws("non-member can't see a team", "team", "none", "workspace.view", "not_found"),
  ws("non-member can't rename a team", "team", "none", "workspace.update", "not_found"),
  ws("non-member can't delete a team", "team", "none", "workspace.delete", "not_found"),
  ws(
    "non-member can't manage team members",
    "team",
    "none",
    "workspace.manageMembers",
    "not_found",
  ),

  // Soft-deleted workspaces are invisible to everyone (resolved by the API, not the matrix).
  ws("deleted team is gone for its owner", "team", "owner", "workspace.view", "not_found", {
    deleted: true,
  }),
];

/** List cases. `actorRole` grows with sharing (M7.2): collaborator, viewer, team owner. */
export interface ListPermissionFixture {
  name: string;
  setup: { list: { deleted?: boolean }; actorRole: ListRole | "none" };
  action: ListAction;
  resource: { type: "list" };
  expected: Decision;
}

const list = (
  name: string,
  actorRole: ListRole | "none",
  action: ListAction,
  expected: Decision,
  extra: { deleted?: boolean } = {},
): ListPermissionFixture => ({
  name,
  setup: { list: extra, actorRole },
  action,
  resource: { type: "list" },
  expected,
});

export const listPermissionFixtures: readonly ListPermissionFixture[] = [
  list("creator views own list", "creator", "list.view", "allow"),
  list("creator edits own list", "creator", "list.edit", "allow"),
  list("creator manages own list", "creator", "list.manage", "allow"),
  list("stranger can't see a private list", "none", "list.view", "not_found"),
  list("stranger can't edit a private list", "none", "list.edit", "not_found"),
  list("stranger can't delete a private list", "none", "list.manage", "not_found"),
  list("deleted list is gone for its creator", "creator", "list.view", "not_found", {
    deleted: true,
  }),
  list("deleted list can't be edited", "creator", "list.edit", "not_found", { deleted: true }),
];

/** Section cases: sections are private to their user. */
export interface SectionPermissionFixture {
  name: string;
  setup: { section: { isDefault: boolean }; actorRole: "owner" | "none" };
  action: SectionAction;
  resource: { type: "section" };
  expected: Decision;
}

const section = (
  name: string,
  actorRole: "owner" | "none",
  isDefault: boolean,
  action: SectionAction,
  expected: Decision,
): SectionPermissionFixture => ({
  name,
  setup: { section: { isDefault }, actorRole },
  action,
  resource: { type: "section" },
  expected,
});

export const sectionPermissionFixtures: readonly SectionPermissionFixture[] = [
  section("owner views own section", "owner", false, "section.view", "allow"),
  section("owner updates own section", "owner", false, "section.update", "allow"),
  section("owner deletes own section", "owner", false, "section.delete", "allow"),
  section("owner renames Favorites", "owner", true, "section.update", "allow"),
  section("owner can't delete Favorites", "owner", true, "section.delete", "forbidden"),
  section("stranger can't see a section", "none", false, "section.view", "not_found"),
  section("stranger can't update a section", "none", false, "section.update", "not_found"),
  section("stranger can't delete a section", "none", false, "section.delete", "not_found"),
];

/**
 * Cases for tasks that live in no list (Inbox-only). `actorRole` grows with assigning (M7.3).
 * Tasks in a list follow `listPermissionFixtures` through their home list.
 */
export interface TaskPermissionFixture {
  name: string;
  setup: { task: { deleted?: boolean }; actorRole: TaskRole | "none" };
  action: TaskAction;
  resource: { type: "task" };
  expected: Decision;
}

const task = (
  name: string,
  actorRole: TaskRole | "none",
  action: TaskAction,
  expected: Decision,
  extra: { deleted?: boolean } = {},
): TaskPermissionFixture => ({
  name,
  setup: { task: extra, actorRole },
  action,
  resource: { type: "task" },
  expected,
});

export const taskPermissionFixtures: readonly TaskPermissionFixture[] = [
  task("creator views own inbox task", "creator", "task.view", "allow"),
  task("creator edits own inbox task", "creator", "task.edit", "allow"),
  task("stranger can't see an inbox task", "none", "task.view", "not_found"),
  task("stranger can't edit an inbox task", "none", "task.edit", "not_found"),
  task("deleted inbox task is gone for its creator", "creator", "task.view", "not_found", {
    deleted: true,
  }),
];

/** Every fixture, for name-uniqueness checks. */
export const allPermissionFixtures: readonly { name: string; action: Action }[] = [
  ...permissionFixtures,
  ...listPermissionFixtures,
  ...sectionPermissionFixtures,
  ...taskPermissionFixtures,
];
