import { labels, outbox } from "@flolist/db";
import {
  apiErrorSchema,
  changeEventSchema,
  labelPageSchema,
  labelSchema,
  MAX_WORKSPACE_LABELS,
  permissionFixtures,
  taskSchema,
  updateLabelResultSchema,
  uuidv7,
} from "@flolist/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import {
  addMember,
  as,
  buildFixture,
  makeList,
  makePersonalWorkspace,
  makeTeam,
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

const cmid = () => crypto.randomUUID();

async function ok(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

const request = (who: { id: string }, method: string, path: string, body?: object) =>
  testApp(t.db).request(
    `/api/v1/labels${path}`,
    as(who, body ? send(method, { clientMutationId: cmid(), ...body }) : { method }),
  );

async function createLabel(who: { id: string }, workspaceId: string, name: string, status = 201) {
  return labelSchema.parse(
    await ok(await request(who, "POST", "", { id: uuidv7(), workspaceId, name }), status),
  );
}

async function listLabels(who: { id: string }) {
  return labelPageSchema.parse(await ok(await request(who, "GET", ""))).items;
}

/** A task in a fresh list of `workspaceId` carrying `labelIds`. */
async function taskWith(who: { id: string }, workspaceId: string, labelIds: string[]) {
  const list = await makeList(t.db, who, { workspaceId });
  const taskId = uuidv7();
  await ok(
    await testApp(t.db).request(
      `/api/v1/lists/${list.id}/blocks/batch`,
      as(
        who,
        send("POST", {
          clientMutationId: cmid(),
          ops: [
            {
              op: "upsert",
              id: uuidv7(),
              type: "task",
              position: "a0",
              content: { inline: [{ type: "text", text: "Task" }] },
              task: { id: taskId, labelIds },
            },
          ],
        }),
      ),
    ),
  );
  return taskId;
}

async function taskLabelIds(who: { id: string }, taskId: string) {
  return taskSchema.parse(await ok(await testApp(t.db).request(`/api/v1/tasks/${taskId}`, as(who))))
    .labelIds;
}

describe("creating and listing labels", () => {
  it("creates a label, and answers the existing one for the same name in any case", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const home = await createLabel(me, ws.id, " #Home ");
    expect(home).toMatchObject({ name: "Home", color: null, taskCount: 0, workspaceId: ws.id });
    const again = await createLabel(me, ws.id, "home", 200);
    expect(again.id).toBe(home.id);
  });

  it("lists the labels of every workspace the caller is in, by name, with task counts", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const owner = await makeUser(t.db);
    const team = await makeTeam(t.db, owner);
    await addMember(t.db, team, me, "member");
    const stranger = await makeUser(t.db);
    const strangerWs = await makePersonalWorkspace(t.db, stranger);

    const zed = await createLabel(me, ws.id, "zed");
    await createLabel(me, team.id, "Alpha");
    await createLabel(stranger, strangerWs.id, "Private");
    await taskWith(me, ws.id, [zed.id]);

    const mine = await listLabels(me);
    expect(mine.map((l) => l.name)).toEqual(["Alpha", "zed"]);
    expect(mine.find((l) => l.name === "zed")?.taskCount).toBe(1);
    expect((await listLabels(stranger)).map((l) => l.name)).toEqual(["Private"]);
  });

  it("refuses bad input and enforces the workspace limit", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const bad = await request(me, "POST", "", { id: uuidv7(), workspaceId: ws.id, name: " # " });
    expect(bad.status).toBe(400);
    const colour = await request(me, "POST", "", {
      id: uuidv7(),
      workspaceId: ws.id,
      name: "Pink",
      color: "pink",
    });
    expect(colour.status).toBe(400);

    await t.db.insert(labels).values(
      Array.from({ length: MAX_WORKSPACE_LABELS }, (_, i) => ({
        workspaceId: ws.id,
        name: `l${String(i)}`,
      })),
    );
    const full = await request(me, "POST", "", {
      id: uuidv7(),
      workspaceId: ws.id,
      name: "One more",
    });
    expect(full.status).toBe(403);
    expect(apiErrorSchema.parse(await full.json()).error.code).toBe("LIMIT");
  });

  it("emits label events on the workspace channel", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const label = await createLabel(me, ws.id, "Live");
    const rows = await t.db.select().from(outbox);
    const event = rows.find((r) => {
      const e = changeEventSchema.parse(r.event);
      return e.entity === "label" && e.id === label.id;
    });
    expect(event?.channels).toEqual([`workspace:${ws.id}`]);
  });
});

describe("renaming, merging and deleting", () => {
  it("renames and recolours", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const label = await createLabel(me, ws.id, "Wrok");
    const res = updateLabelResultSchema.parse(
      await ok(await request(me, "PATCH", `/${label.id}`, { name: "Work", color: "blue" })),
    );
    expect(res).toMatchObject({
      mergedFrom: null,
      label: { id: label.id, name: "Work", color: "blue" },
    });
    expect(res.label.version).toBe(label.version + 1);
    // A case-only rename is a rename, not a merge.
    const cased = updateLabelResultSchema.parse(
      await ok(await request(me, "PATCH", `/${label.id}`, { name: "WORK" })),
    );
    expect(cased).toMatchObject({ mergedFrom: null, label: { id: label.id, name: "WORK" } });
  });

  it("merges into the label that already has the new name", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const errands = await createLabel(me, ws.id, "Errands");
    const chores = await createLabel(me, ws.id, "Chores");
    const onlyChores = await taskWith(me, ws.id, [chores.id]);
    const both = await taskWith(me, ws.id, [errands.id, chores.id]);

    const res = updateLabelResultSchema.parse(
      await ok(await request(me, "PATCH", `/${chores.id}`, { name: "errands" })),
    );
    expect(res.mergedFrom).toBe(chores.id);
    expect(res.label).toMatchObject({ id: errands.id, name: "Errands", taskCount: 2 });
    expect(await taskLabelIds(me, onlyChores)).toEqual([errands.id]);
    expect(await taskLabelIds(me, both)).toEqual([errands.id]);
    expect((await listLabels(me)).map((l) => l.id)).toEqual([errands.id]);

    const events = (await t.db.select().from(outbox)).map((r) => changeEventSchema.parse(r.event));
    expect(
      events.some((e) => e.op === "delete" && e.entity === "label" && e.id === chores.id),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.op === "upsert" &&
          e.entity === "task" &&
          e.id === onlyChores &&
          e.data.labelIds.includes(errands.id),
      ),
    ).toBe(true);
  });

  it("deletes a label and removes it from its tasks", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const label = await createLabel(me, ws.id, "Gone");
    const taskId = await taskWith(me, ws.id, [label.id]);
    await ok(await request(me, "DELETE", `/${label.id}`, {}));
    expect(await taskLabelIds(me, taskId)).toEqual([]);
    expect(await listLabels(me)).toEqual([]);
    expect((await request(me, "DELETE", `/${label.id}`, {})).status).toBe(404);
  });

  it("hides other people's labels", async () => {
    const me = await makeUser(t.db);
    const other = await makeUser(t.db);
    const otherWs = await makePersonalWorkspace(t.db, other);
    const theirs = await createLabel(other, otherWs.id, "Theirs");
    expect((await request(me, "PATCH", `/${theirs.id}`, { name: "Mine" })).status).toBe(404);
    expect((await request(me, "DELETE", `/${theirs.id}`, {})).status).toBe(404);
  });
});

describe("label management against the permission fixtures", () => {
  const statusFor = { allow: 200, forbidden: 403, not_found: 404 } as const;
  const cases = permissionFixtures.filter((f) => f.action === "workspace.manageLabels");

  it.each(cases.map((f) => [f.name, f] as const))("%s", async (_name, f) => {
    const { actor, workspace } = await buildFixture(t.db, f.setup);
    const [label] = await t.db
      .insert(labels)
      .values({ workspaceId: workspace.id, name: "Shared" })
      .returning();
    if (!label) throw new Error("label");
    const res = await request(actor, "PATCH", `/${label.id}`, { color: "green" });
    expect(res.status).toBe(statusFor[f.expected]);
  });
});
