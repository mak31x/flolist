import {
  listPermissionFixtures,
  permissionFixtures,
  sectionPermissionFixtures,
  type Action,
  type ListAction,
  type SectionAction,
} from "@flolist/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize } from "../src/authz/authorize.ts";
import { ApiException } from "../src/lib/errors.ts";
import { createTestDb, type TestDb } from "./db.ts";
import {
  as,
  buildFixture,
  buildListFixture,
  buildSectionFixture,
  jsonBody,
  send,
  testApp,
} from "./factories.ts";

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
  "workspace.useLabels": (id) => [
    "/api/v1/labels",
    send("POST", {
      clientMutationId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      workspaceId: id,
      name: "Errands",
    }),
  ],
  "workspace.createList": (id) => [
    "/api/v1/lists",
    send("POST", {
      clientMutationId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      workspaceId: id,
    }),
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
    // Creates answer 201.
    expect(res.status === 201 ? 200 : res.status).toBe(statusFor[f.expected]);
  });
});

const mutation = () => ({ clientMutationId: crypto.randomUUID() });

describe("authorize() against the list and section fixtures", () => {
  it.each(listPermissionFixtures.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, list } = await buildListFixture(t.db, f.setup);
    const result = authorize(t.db, actor, f.action, { type: "list", id: list.id });
    const code = codeFor[f.expected];
    if (code === null) await expect(result).resolves.toMatchObject({ list: { id: list.id } });
    else
      await expect(result).rejects.toSatisfy((e) => e instanceof ApiException && e.code === code);
  });

  it.each(sectionPermissionFixtures.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, section } = await buildSectionFixture(t.db, f.setup);
    const result = authorize(t.db, actor, f.action, { type: "section", id: section.id });
    const code = codeFor[f.expected];
    if (code === null) {
      await expect(result).resolves.toMatchObject({ section: { id: section.id } });
    } else {
      await expect(result).rejects.toSatisfy((e) => e instanceof ApiException && e.code === code);
    }
  });
});

/** Every list action has a route; each fixture runs through it. */
const listRouteFor: Record<ListAction, (id: string) => [string, RequestInit]> = {
  "list.view": (id) => [`/api/v1/lists/${id}`, {}],
  "list.edit": (id) => [
    `/api/v1/lists/${id}`,
    send("PATCH", { ...mutation(), baseVersion: 1, title: "Renamed" }),
  ],
  "list.manage": (id) => [`/api/v1/lists/${id}`, send("DELETE", mutation())],
};

/** Block routes resolve through their list: reading is `list.view`, any batch is `list.edit`. */
const blockRouteFor: Partial<Record<ListAction, (id: string) => [string, RequestInit]>> = {
  "list.view": (id) => [`/api/v1/lists/${id}/blocks`, {}],
  "list.edit": (id) => [
    `/api/v1/lists/${id}/blocks/batch`,
    send("POST", {
      ...mutation(),
      ops: [{ op: "upsert", id: crypto.randomUUID(), type: "paragraph", position: "a0" }],
    }),
  ],
};

const sectionRouteFor: Partial<Record<SectionAction, (id: string) => [string, RequestInit]>> = {
  "section.update": (id) => [
    `/api/v1/sections/${id}`,
    send("PATCH", { ...mutation(), baseVersion: 1, collapsed: true }),
  ],
  "section.delete": (id) => [`/api/v1/sections/${id}`, send("DELETE", mutation())],
};

describe("list and section routes against the permission fixtures", () => {
  it.each(listPermissionFixtures.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, list } = await buildListFixture(t.db, f.setup);
    const [path, init] = listRouteFor[f.action](list.id);
    const res = await testApp(t.db).request(path, as(actor, init));
    expect(res.status).toBe(statusFor[f.expected]);
  });

  const blockCases = listPermissionFixtures.filter((f) => blockRouteFor[f.action]);
  it.each(blockCases.map((f) => [`blocks: ${f.name}`, f] as const))("%s", async (_name, f) => {
    const { actor, list } = await buildListFixture(t.db, f.setup);
    const route = blockRouteFor[f.action];
    if (!route) throw new Error("unreachable");
    const [path, init] = route(list.id);
    const res = await testApp(t.db).request(path, as(actor, init));
    expect(res.status).toBe(statusFor[f.expected]);
  });

  const sectionCases = sectionPermissionFixtures.filter((f) => sectionRouteFor[f.action]);
  it.each(sectionCases.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, section } = await buildSectionFixture(t.db, f.setup);
    const route = sectionRouteFor[f.action];
    if (!route) throw new Error("unreachable");
    const [path, init] = route(section.id);
    const res = await testApp(t.db).request(path, as(actor, init));
    expect(res.status).toBe(statusFor[f.expected]);
  });
});
