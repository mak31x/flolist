import { describe, expect, it } from "vitest";
import { decide, permissionFixtures, workspaceActions } from "./index.ts";

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
    const names = permissionFixtures.map((f) => f.name);
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
