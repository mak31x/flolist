import {
  listPermissionFixtures,
  permissionFixtures,
  sectionPermissionFixtures,
  taskPermissionFixtures,
  type Action,
  type ListAction,
  type SectionAction,
  type TaskAction,
} from "@flolist/shared";
import { tasks } from "@flolist/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize } from "../src/authz/authorize.ts";
import { ApiException } from "../src/lib/errors.ts";
import { createTestDb, type TestDb } from "./db.ts";
import {
  as,
  buildFixture,
  buildListFixture,
  buildSectionFixture,
  buildTaskFixture,
  jsonBody,
  makeInboxOnlyTask,
  makeList,
  makeUser,
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
  "workspace.createTask": (id) => [
    "/api/v1/inbox/tasks",
    send("POST", {
      clientMutationId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      workspaceId: id,
      position: "a0",
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

/** Every task action has a route; Inbox-only tasks resolve through their creator. */
const taskRouteFor: Record<TaskAction, (id: string) => [string, RequestInit]> = {
  "task.view": (id) => [`/api/v1/tasks/${id}`, {}],
  "task.edit": (id) => [`/api/v1/tasks/${id}`, send("PATCH", { ...mutation(), priority: 2 })],
};

describe("authorize() and task routes against the task fixtures", () => {
  it.each(taskPermissionFixtures.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, task } = await buildTaskFixture(t.db, f.setup);
    const result = authorize(t.db, actor, f.action, { type: "task", id: task.id });
    const code = codeFor[f.expected];
    if (code === null) {
      await expect(result).resolves.toMatchObject({ task: { id: task.id }, list: null });
    } else {
      await expect(result).rejects.toSatisfy((e) => e instanceof ApiException && e.code === code);
    }
  });

  it.each(taskPermissionFixtures.map((f) => [`route: ${f.name}`, f] as const))(
    "%s",
    async (_name, f) => {
      const { actor, task } = await buildTaskFixture(t.db, f.setup);
      const [path, init] = taskRouteFor[f.action](task.id);
      const res = await testApp(t.db).request(path, as(actor, init));
      expect(res.status).toBe(statusFor[f.expected]);
    },
  );

  it("resolves an Inbox-only subtask through its top-level task", async () => {
    const owner = await makeUser(t.db);
    const stranger = await makeUser(t.db);
    const parent = await makeInboxOnlyTask(t.db, owner);
    // Created by someone else, but it sits under the owner's task.
    const sub = await makeInboxOnlyTask(t.db, stranger, {
      parentTaskId: parent.id,
      workspaceId: parent.workspaceId,
    });
    await expect(
      authorize(t.db, owner, "task.edit", { type: "task", id: sub.id }),
    ).resolves.toMatchObject({ task: { id: sub.id } });
    await expect(
      authorize(t.db, stranger, "task.view", { type: "task", id: sub.id }),
    ).rejects.toSatisfy((e) => e instanceof ApiException && e.code === "NOT_FOUND");
  });

  it("maps task actions onto the home list for tasks in a list", async () => {
    const owner = await makeUser(t.db);
    const stranger = await makeUser(t.db);
    const list = await makeList(t.db, owner);
    const task = await makeInboxOnlyTask(t.db, stranger, { workspaceId: list.workspaceId });
    await t.db
      .update(tasks)
      .set({ listId: list.id, rootListId: list.id })
      .where(eq(tasks.id, task.id));
    await expect(
      authorize(t.db, owner, "task.edit", { type: "task", id: task.id }),
    ).resolves.toMatchObject({ list: { id: list.id }, root: { id: list.id } });
    // Creating a task doesn't grant access once it lives in someone else's list.
    await expect(
      authorize(t.db, stranger, "task.view", { type: "task", id: task.id }),
    ).rejects.toSatisfy((e) => e instanceof ApiException && e.code === "NOT_FOUND");
  });
});
