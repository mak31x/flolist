import { permissionFixtures, type Action } from "@flolist/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize } from "../src/authz/authorize.ts";
import { ApiException } from "../src/lib/errors.ts";
import { createTestDb, type TestDb } from "./db.ts";
import { as, buildFixture, jsonBody, testApp } from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const codeFor = { allow: null, forbidden: "FORBIDDEN", not_found: "NOT_FOUND" } as const;

describe("authorize() against the permission fixtures", () => {
  it.each(permissionFixtures.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, workspace } = await buildFixture(t.db, f.setup);
    const result = authorize(t.db, actor, f.action, { type: "workspace", id: workspace.id });
    const code = codeFor[f.expected];
    if (code === null) {
      await expect(result).resolves.toMatchObject({ workspace: { id: workspace.id } });
    } else {
      await expect(result).rejects.toSatisfy((e) => e instanceof ApiException && e.code === code);
    }
  });

  it("rejects a missing user before touching the resource", async () => {
    await expect(
      authorize(t.db, null, "workspace.view", { type: "workspace", id: crypto.randomUUID() }),
    ).rejects.toSatisfy((e) => e instanceof ApiException && e.code === "UNAUTHENTICATED");
  });
});

/** Fixtures whose action has an HTTP route today. Others are covered by authorize() above. */
const routeFor: Partial<Record<Action, (id: string) => [string, RequestInit]>> = {
  "workspace.view": (id) => [`/api/v1/workspaces/${id}`, {}],
  "workspace.update": (id) => [
    `/api/v1/workspaces/${id}`,
    jsonBody({ clientMutationId: crypto.randomUUID(), baseVersion: 1, name: "Renamed" }),
  ],
};
const statusFor = { allow: 200, forbidden: 403, not_found: 404 } as const;

describe("workspace routes against the permission fixtures", () => {
  const cases = permissionFixtures.filter((f) => routeFor[f.action]);

  it.each(cases.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, workspace } = await buildFixture(t.db, f.setup);
    const route = routeFor[f.action];
    if (!route) throw new Error("unreachable");
    const [path, init] = route(workspace.id);
    const res = await testApp(t.db).request(path, as(actor, init));
    expect(res.status).toBe(statusFor[f.expected]);
  });
});
