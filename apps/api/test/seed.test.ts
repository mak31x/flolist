import { member, seed, seedIds, user, workspaces } from "@flolist/db";
import { workspaceListSchema } from "@flolist/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import { as, testApp } from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

describe("seed", () => {
  it("is deterministic and can be re-run", async () => {
    await seed(t.db);
    await seed(t.db);
    expect(await t.db.$count(user)).toBe(3);
    expect(await t.db.$count(member)).toBe(3);
    expect(await t.db.$count(workspaces)).toBe(4);
  });

  it("gives the demo user their Personal workspace and Acme as owner", async () => {
    await seed(t.db);
    const res = await testApp(t.db).request("/api/v1/workspaces", as({ id: seedIds.users.demo }));
    const { items } = workspaceListSchema.parse(await res.json());
    expect(items.map((w) => [w.id, w.name, w.role])).toEqual([
      [seedIds.workspaces.demoPersonal, "Personal", "owner"],
      [seedIds.workspaces.acme, "Acme", "owner"],
    ]);
  });

  it("makes the teammates Acme members", async () => {
    await seed(t.db);
    const res = await testApp(t.db).request(
      `/api/v1/workspaces/${seedIds.workspaces.acme}`,
      as({ id: seedIds.users.alex }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "member" });
  });
});
