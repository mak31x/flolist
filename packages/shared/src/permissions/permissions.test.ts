import { describe, expect, it } from "vitest";
import {
  allPermissionFixtures,
  decide,
  listActions,
  listPermissionFixtures,
  permissionFixtures,
  sectionActions,
  sectionPermissionFixtures,
  taskActions,
  taskPermissionFixtures,
  workspaceActions,
} from "./index.ts";

describe("permission matrix", () => {
  // Deleted resources are resolved before the matrix runs (the API sees role = null).
  const matrixCases = permissionFixtures.filter((f) => !f.setup.workspace.deleted);

  it.each(matrixCases.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const role = f.setup.actorRole === "none" ? null : f.setup.actorRole;
    expect(decide(f.action, { type: "workspace", kind: f.setup.workspace.kind, role })).toBe(
      f.expected,
    );
  });

  it("has unique fixture names", () => {
    const names = allPermissionFixtures.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every workspace action for every kind and role", () => {
    for (const kind of ["personal", "team"] as const) {
      for (const role of ["owner", "member", "none"] as const) {
        if (kind === "personal" && role === "member") continue; // can't exist
        for (const action of workspaceActions) {
          const covered = permissionFixtures.some(
            (f) =>
              f.action === action &&
              f.setup.workspace.kind === kind &&
              f.setup.actorRole === role &&
              !f.setup.workspace.deleted,
          );
          expect(covered, `${kind}/${role}/${action}`).toBe(true);
        }
      }
    }
  });
});

describe("list and section matrix", () => {
  const listCases = listPermissionFixtures.filter((f) => !f.setup.list.deleted);
  it.each(listCases.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const role = f.setup.actorRole === "none" ? null : f.setup.actorRole;
    expect(decide(f.action, { type: "list", role })).toBe(f.expected);
  });

  it.each(sectionPermissionFixtures.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const role = f.setup.actorRole === "none" ? null : f.setup.actorRole;
    expect(decide(f.action, { type: "section", role, isDefault: f.setup.section.isDefault })).toBe(
      f.expected,
    );
  });

  it("covers every list and section action for every role", () => {
    for (const role of ["creator", "none"] as const) {
      for (const action of listActions) {
        expect(
          listPermissionFixtures.some((f) => f.action === action && f.setup.actorRole === role),
          `list/${role}/${action}`,
        ).toBe(true);
      }
    }
    for (const role of ["owner", "none"] as const) {
      for (const action of sectionActions) {
        expect(
          sectionPermissionFixtures.some((f) => f.action === action && f.setup.actorRole === role),
          `section/${role}/${action}`,
        ).toBe(true);
      }
    }
  });

  const taskCases = taskPermissionFixtures.filter((f) => !f.setup.task.deleted);
  it.each(taskCases.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const role = f.setup.actorRole === "none" ? null : f.setup.actorRole;
    expect(decide(f.action, { type: "task", role })).toBe(f.expected);
  });

  it("covers every task action for every role", () => {
    for (const role of ["creator", "none"] as const) {
      for (const action of taskActions) {
        expect(
          taskPermissionFixtures.some((f) => f.action === action && f.setup.actorRole === role),
          `task/${role}/${action}`,
        ).toBe(true);
      }
    }
  });

  it("never lets a workspace subject do list actions", () => {
    expect(decide("list.view", { type: "workspace", kind: "personal", role: "owner" })).toBe(
      "forbidden",
    );
  });
});
