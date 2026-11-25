import type { Db } from "./client.ts";
import { member, organization, user, userSettings, workspaces } from "./schema/index.ts";

/** Fixed UUIDv7-shaped ids so e2e tests can rely on the seed (data-model.md → Seed data). */
export const seedIds = {
  users: {
    demo: "01900000-0000-7000-8000-000000000001",
    alex: "01900000-0000-7000-8000-000000000002",
    sam: "01900000-0000-7000-8000-000000000003",
  },
  organizations: {
    acme: "01900000-0000-7000-8000-000000000101",
  },
  members: {
    acmeDemo: "01900000-0000-7000-8000-000000000201",
    acmeAlex: "01900000-0000-7000-8000-000000000202",
    acmeSam: "01900000-0000-7000-8000-000000000203",
  },
  workspaces: {
    demoPersonal: "01900000-0000-7000-8000-000000000301",
    alexPersonal: "01900000-0000-7000-8000-000000000302",
    samPersonal: "01900000-0000-7000-8000-000000000303",
    acme: "01900000-0000-7000-8000-000000000304",
  },
} as const;

const createdAt = new Date("2026-01-01T09:00:00.000Z");

const users = [
  { id: seedIds.users.demo, first: "Demo", last: "User", email: "demo@flolist.localhost" },
  { id: seedIds.users.alex, first: "Alex", last: "Rivera", email: "alex@flolist.localhost" },
  { id: seedIds.users.sam, first: "Sam", last: "Chen", email: "sam@flolist.localhost" },
] as const;

/**
 * Inserts the deterministic demo data. Safe to re-run: existing rows are left alone.
 * Lists, blocks, Inbox items and notifications are added in the phases that create those tables.
 */
export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(user)
      .values(
        users.map((u) => ({
          id: u.id,
          name: `${u.first} ${u.last}`,
          firstName: u.first,
          lastName: u.last,
          email: u.email,
          emailVerified: true,
          timezone: "Europe/Berlin",
          createdAt,
          updatedAt: createdAt,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(userSettings)
      .values(users.map((u) => ({ userId: u.id, updatedAt: createdAt })))
      .onConflictDoNothing();

    await tx
      .insert(organization)
      .values({ id: seedIds.organizations.acme, name: "Acme", slug: "acme", createdAt })
      .onConflictDoNothing();

    await tx
      .insert(member)
      .values([
        {
          id: seedIds.members.acmeDemo,
          organizationId: seedIds.organizations.acme,
          userId: seedIds.users.demo,
          role: "owner",
          createdAt,
        },
        {
          id: seedIds.members.acmeAlex,
          organizationId: seedIds.organizations.acme,
          userId: seedIds.users.alex,
          role: "member",
          createdAt,
        },
        {
          id: seedIds.members.acmeSam,
          organizationId: seedIds.organizations.acme,
          userId: seedIds.users.sam,
          role: "member",
          createdAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(workspaces)
      .values([
        {
          id: seedIds.workspaces.demoPersonal,
          kind: "personal",
          name: "Personal",
          ownerId: seedIds.users.demo,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: seedIds.workspaces.alexPersonal,
          kind: "personal",
          name: "Personal",
          ownerId: seedIds.users.alex,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: seedIds.workspaces.samPersonal,
          kind: "personal",
          name: "Personal",
          ownerId: seedIds.users.sam,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: seedIds.workspaces.acme,
          kind: "team",
          name: "Acme",
          emoji: "🚀",
          ownerId: seedIds.users.demo,
          organizationId: seedIds.organizations.acme,
          createdAt,
          updatedAt: createdAt,
        },
      ])
      .onConflictDoNothing();
  });
}
