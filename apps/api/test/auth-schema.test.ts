import { account, invitation, session, user, verification } from "@flolist/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db.ts";
import { makeTeam, makeUser } from "./factories.ts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

const inAnHour = () => new Date(Date.now() + 3_600_000);

describe("Better Auth tables (migration 0001)", () => {
  it("gives sessions, accounts and verifications UUIDv7 ids and timestamps", async () => {
    const u = await makeUser(t.db);
    const [s] = await t.db
      .insert(session)
      .values({ userId: u.id, token: `tok-${u.id}`, expiresAt: inAnHour() })
      .returning();
    const [a] = await t.db
      .insert(account)
      .values({ userId: u.id, providerId: "credential", accountId: u.id, password: "hash" })
      .returning();
    const [v] = await t.db
      .insert(verification)
      .values({ identifier: "reset-password:x", value: "y", expiresAt: inAnHour() })
      .returning();
    for (const row of [s, a, v]) {
      expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(row?.createdAt).toBeInstanceOf(Date);
      expect(row?.updatedAt).toBeInstanceOf(Date);
    }
  });

  it("rejects a duplicate session token and a duplicate provider account", async () => {
    const u = await makeUser(t.db);
    const values = { userId: u.id, token: `dup-${u.id}`, expiresAt: inAnHour() };
    await t.db.insert(session).values(values);
    await expect(t.db.insert(session).values(values)).rejects.toThrow();

    const acc = { userId: u.id, providerId: "google", accountId: `g-${u.id}` };
    await t.db.insert(account).values(acc);
    await expect(t.db.insert(account).values(acc)).rejects.toThrow();
  });

  it("deletes sessions and accounts with their user", async () => {
    const u = await makeUser(t.db);
    await t.db
      .insert(session)
      .values({ userId: u.id, token: `del-${u.id}`, expiresAt: inAnHour() });
    await t.db.insert(account).values({ userId: u.id, providerId: "credential", accountId: u.id });
    await t.db.delete(user).where(eq(user.id, u.id));
    expect(await t.db.$count(session, eq(session.userId, u.id))).toBe(0);
    expect(await t.db.$count(account, eq(account.userId, u.id))).toBe(0);
  });

  it("limits invitation roles and statuses", async () => {
    const owner = await makeUser(t.db);
    const team = await makeTeam(t.db, owner);
    if (!team.organizationId) throw new Error("team without organization");
    const base = {
      organizationId: team.organizationId,
      inviterId: owner.id,
      email: "invitee@test.localhost",
      expiresAt: inAnHour(),
    };
    const [inv] = await t.db
      .insert(invitation)
      .values({ ...base, role: "member" })
      .returning();
    expect(inv?.status).toBe("pending");
    await expect(
      t.db.insert(invitation).values({ ...base, role: "admin" as "member" }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(invitation).values({ ...base, status: "expired" as "pending" }),
    ).rejects.toThrow();
  });
});
