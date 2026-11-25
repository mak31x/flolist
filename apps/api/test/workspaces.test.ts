import { apiErrorSchema, workspaceListSchema, workspaceSchema } from "@flolist/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import {
  addMember,
  as,
  jsonBody,
  makePersonalWorkspace,
  makeTeam,
  makeUser,
  testApp,
} from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const patch = (body: Record<string, unknown>) =>
  jsonBody({ clientMutationId: crypto.randomUUID(), baseVersion: 1, ...body });

describe("GET /api/v1/workspaces", () => {
  it("returns 401 without a user", async () => {
    const res = await testApp(t.db).request("/api/v1/workspaces");
    expect(res.status).toBe(401);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("lists the caller's personal workspace first, then their teams, and nothing else", async () => {
    const me = await makeUser(t.db);
    const other = await makeUser(t.db);
    const personal = await makePersonalWorkspace(t.db, me);
    const zeta = await makeTeam(t.db, other, "Zeta");
    await addMember(t.db, zeta, me);
    const alpha = await makeTeam(t.db, me, "Alpha");
    await makePersonalWorkspace(t.db, other);
    await makeTeam(t.db, other, "Not mine");

    const res = await testApp(t.db).request("/api/v1/workspaces", as(me));
    expect(res.status).toBe(200);
    const { items } = workspaceListSchema.parse(await res.json());
    expect(items.map((w) => [w.id, w.role])).toEqual([
      [personal.id, "owner"],
      [alpha.id, "owner"],
      [zeta.id, "member"],
    ]);
  });
});

describe("GET /api/v1/workspaces/:id", () => {
  it("returns VALIDATION for a malformed id", async () => {
    const me = await makeUser(t.db);
    const res = await testApp(t.db).request("/api/v1/workspaces/not-a-uuid", as(me));
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details).toEqual([
      expect.objectContaining({ source: "param", path: ["id"] }),
    ]);
  });

  it("returns 404 for an id that doesn't exist", async () => {
    const me = await makeUser(t.db);
    const res = await testApp(t.db).request(`/api/v1/workspaces/${crypto.randomUUID()}`, as(me));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/workspaces/:id", () => {
  it("renames and bumps the version", async () => {
    const me = await makeUser(t.db);
    const ws = await makeTeam(t.db, me, "Old");
    const res = await testApp(t.db).request(
      `/api/v1/workspaces/${ws.id}`,
      as(me, patch({ name: "  New name ", emoji: "🎯" })),
    );
    expect(res.status).toBe(200);
    const body = workspaceSchema.parse(await res.json());
    expect(body).toMatchObject({ name: "New name", emoji: "🎯", version: ws.version + 1 });
  });

  it("requires mutation metadata and at least one field", async () => {
    const me = await makeUser(t.db);
    const ws = await makeTeam(t.db, me);
    const app = testApp(t.db);

    const noMeta = await app.request(
      `/api/v1/workspaces/${ws.id}`,
      as(me, jsonBody({ name: "x" })),
    );
    expect(noMeta.status).toBe(400);
    const paths = (apiErrorSchema.parse(await noMeta.json()).error.details as { path: string[] }[])
      .map((d) => d.path.join("."))
      .sort();
    expect(paths).toEqual(["baseVersion", "clientMutationId"]);

    const empty = await app.request(`/api/v1/workspaces/${ws.id}`, as(me, patch({})));
    expect(empty.status).toBe(400);
  });

  it("rejects a body that isn't JSON with VALIDATION", async () => {
    const me = await makeUser(t.db);
    const ws = await makeTeam(t.db, me);
    const res = await testApp(t.db).request(
      `/api/v1/workspaces/${ws.id}`,
      as(me, { method: "PATCH", body: "{nope", headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("VALIDATION");
  });
});
