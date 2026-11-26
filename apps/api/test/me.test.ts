import { files, user } from "@flolist/db";
import { meSchema } from "@flolist/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitName } from "../src/routes/me.ts";
import { createTestDb, type TestDb } from "./db.ts";
import { as, makePersonalWorkspace, makeTeam, makeUser, testApp } from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const patch = (who: { id: string }, body: Record<string, unknown>) =>
  testApp(t.db).request(
    "/api/v1/me",
    as(who, {
      method: "PATCH",
      body: JSON.stringify({ clientMutationId: crypto.randomUUID(), baseVersion: 1, ...body }),
      headers: { "content-type": "application/json" },
    }),
  );

async function readyFile(
  workspaceId: string,
  uploadedBy: string,
  over: Partial<typeof files.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await t.db.insert(files).values({
    id,
    workspaceId,
    storageKey: `ws/${workspaceId}/${id}`,
    filename: "a.png",
    mime: "image/png",
    sizeBytes: 10,
    status: "ready",
    uploadedBy,
    ...over,
  });
  return id;
}

describe("splitName", () => {
  it.each([
    ["Ada Lovelace", "Ada", "Lovelace"],
    ["  Grace  ", "Grace", ""],
    ["Jean Le Rond d'Alembert", "Jean", "Le Rond d'Alembert"],
  ])("%j", (name, firstName, lastName) => {
    expect(splitName(name)).toEqual({ firstName, lastName });
  });
});

describe("GET /api/v1/me", () => {
  it("derives first/last name from the display name and defaults locale to system", async () => {
    const me = await makeUser(t.db, "Ada Lovelace");
    const res = await testApp(t.db).request("/api/v1/me", as(me));
    expect(meSchema.parse(await res.json())).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      avatarUrl: null,
      avatarFileId: null,
      locale: "system",
      timezone: "UTC",
      weekStart: "system",
      soundsEnabled: true,
    });
  });
});

describe("PATCH /api/v1/me", () => {
  it("returns 401 without a user", async () => {
    const res = await testApp(t.db).request("/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify({
        clientMutationId: crypto.randomUUID(),
        baseVersion: 1,
        theme: "dark",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("saves names and keeps the display name in sync", async () => {
    const me = await makeUser(t.db, "Ada Lovelace");
    const res = await patch(me, { firstName: " Augusta ", lastName: "King" });
    expect(res.status).toBe(200);
    expect(meSchema.parse(await res.json())).toMatchObject({
      name: "Augusta King",
      firstName: "Augusta",
      lastName: "King",
      version: 2,
    });
    // Only the last name: the first name stays.
    const body = meSchema.parse(await (await patch(me, { lastName: "" })).json());
    expect(body).toMatchObject({ name: "Augusta", firstName: "Augusta", lastName: "" });
  });

  it("saves timezone, first day of the week and language without touching the name", async () => {
    const me = await makeUser(t.db, "Ada Lovelace");
    const res = await patch(me, { timezone: "Asia/Kolkata", weekStart: "sun", locale: "en" });
    expect(meSchema.parse(await res.json())).toMatchObject({
      name: "Ada Lovelace",
      timezone: "Asia/Kolkata",
      weekStart: "sun",
      locale: "en",
    });
    const [row] = await t.db.select().from(user).where(eq(user.id, me.id));
    expect(row?.firstName).toBeNull();
  });

  it.each([
    [{ timezone: "Mars/Olympus" }],
    [{ weekStart: "tue" }],
    [{ locale: "de" }],
    [{ firstName: "" }],
    [{ firstName: "x".repeat(101) }],
    [{}],
  ])("rejects %j", async (body) => {
    const me = await makeUser(t.db);
    expect((await patch(me, body)).status).toBe(400);
  });

  it("sets and clears an avatar from the caller's own personal workspace", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const fileId = await readyFile(ws.id, me.id);
    const set = meSchema.parse(await (await patch(me, { avatarFileId: fileId })).json());
    expect(set).toMatchObject({ avatarFileId: fileId, avatarUrl: `/api/v1/files/${fileId}` });
    const cleared = meSchema.parse(await (await patch(me, { avatarFileId: null })).json());
    expect(cleared).toMatchObject({ avatarFileId: null, avatarUrl: null });
  });

  it("refuses an avatar that isn't the caller's ready personal image", async () => {
    const me = await makeUser(t.db);
    const other = await makeUser(t.db);
    const mine = await makePersonalWorkspace(t.db, me);
    const theirs = await makePersonalWorkspace(t.db, other);
    const team = await makeTeam(t.db, me);

    const someoneElses = await readyFile(theirs.id, other.id);
    const pending = await readyFile(mine.id, me.id, { status: "pending" });
    const inTeam = await readyFile(team.id, me.id);
    for (const id of [someoneElses, pending, inTeam, crypto.randomUUID()]) {
      expect((await patch(me, { avatarFileId: id })).status).toBe(404);
    }
  });
});
