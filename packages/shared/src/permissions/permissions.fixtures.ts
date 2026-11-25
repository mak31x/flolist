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
import type { Action, Decision, WorkspaceKind, WorkspaceRole } from "./index.ts";

export interface WorkspaceFixtureSetup {
  workspace: { kind: WorkspaceKind; deleted?: boolean };
  /** `"none"` = the actor isn't a member. */
  actorRole: WorkspaceRole | "none";
}

export interface PermissionFixture {
  name: string;
  setup: WorkspaceFixtureSetup;
  action: Action;
  resource: { type: "workspace" };
  expected: Decision;
}

const ws = (
  name: string,
  kind: WorkspaceKind,
  actorRole: WorkspaceRole | "none",
  action: Action,
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
