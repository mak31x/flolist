import {
  lists,
  member,
  organization,
  sections,
  tasks,
  user,
  workspaces,
  type Db,
} from "@flolist/db";
import { eq } from "drizzle-orm";
import type { WorkspaceKind, WorkspaceRole } from "@flolist/shared";
import { createApp, type AppDeps } from "../src/app.ts";
import type { AuthUser } from "../src/types.ts";

let counter = 0;
const next = () => (counter += 1);

export async function makeUser(db: Db, name = `User ${next()}`): Promise<AuthUser> {
  const n = next();
  const [row] = await db
    .insert(user)
    .values({ name, email: `user${n}-${Date.now()}@test.localhost` })
    .returning({ id: user.id });
  if (!row) throw new Error("insert user failed");
  return { id: row.id };
}

export async function makePersonalWorkspace(db: Db, owner: AuthUser) {
  const [ws] = await db
    .insert(workspaces)
    .values({ kind: "personal", name: "Personal", ownerId: owner.id })
    .returning();
  if (!ws) throw new Error("insert workspace failed");
  return ws;
}

export async function makeTeam(db: Db, owner: AuthUser, name = `Team ${next()}`) {
  const [org] = await db
    .insert(organization)
    .values({ name, slug: `team-${next()}-${Date.now()}` })
    .returning();
  if (!org) throw new Error("insert organization failed");
  await db.insert(member).values({ organizationId: org.id, userId: owner.id, role: "owner" });
  const [ws] = await db
    .insert(workspaces)
    .values({ kind: "team", name, ownerId: owner.id, organizationId: org.id })
    .returning();
  if (!ws) throw new Error("insert workspace failed");
  return ws;
}

export async function addMember(
  db: Db,
  ws: { organizationId: string | null },
  who: AuthUser,
  role: WorkspaceRole = "member",
) {
  if (!ws.organizationId) throw new Error("personal workspaces have no members");
  await db.insert(member).values({ organizationId: ws.organizationId, userId: who.id, role });
}

/**
 * Builds the world a permission fixture describes and returns the actor and workspace.
 * The actor owns/joins the workspace per `actorRole`; for "none" someone else owns it.
 */
export async function buildFixture(
  db: Db,
  setup: {
    workspace: { kind: WorkspaceKind; deleted?: boolean };
    actorRole: WorkspaceRole | "none";
  },
) {
  const actor = await makeUser(db, "Actor");
  const other = await makeUser(db, "Other");
  const owner = setup.actorRole === "owner" ? actor : other;
  let ws =
    setup.workspace.kind === "personal"
      ? await makePersonalWorkspace(db, owner)
      : await makeTeam(db, owner);
  if (setup.workspace.kind === "team" && setup.actorRole === "member") {
    await addMember(db, ws, actor, "member");
  }
  if (setup.workspace.deleted) {
    const [deleted] = await db
      .update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, ws.id))
      .returning();
    if (deleted) ws = deleted;
  }
  return { actor, workspace: ws };
}

/**
 * An app whose signed-in user is chosen per request with the `x-test-user` header.
 * Stand-in for Better Auth sessions until M1.1.
 */
export function testApp(db: Db, extra: Partial<AppDeps> = {}) {
  return createApp({
    db,
    resolveUser: (req) => {
      const id = req.headers.get("x-test-user");
      return Promise.resolve(id ? { id } : null);
    },
    ...extra,
  });
}

export const as = (u: AuthUser, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), "x-test-user": u.id },
});

export const jsonBody = (body: unknown): RequestInit => ({
  method: "PATCH",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

/** A request with a JSON body and the given method. */
export const send = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

/** A root list created by `owner` directly in the database. */
export async function makeList(
  db: Db,
  owner: AuthUser,
  values: { title?: string; workspaceId?: string; deleted?: boolean } = {},
) {
  const workspaceId = values.workspaceId ?? (await makePersonalWorkspace(db, owner)).id;
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(lists)
    .values({
      id,
      rootListId: id,
      workspaceId,
      title: values.title ?? "A list",
      createdBy: owner.id,
      deletedAt: values.deleted ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error("insert list failed");
  return row;
}

export async function makeSection(
  db: Db,
  owner: AuthUser,
  values: { title?: string; position?: string; isDefault?: boolean } = {},
) {
  const [row] = await db
    .insert(sections)
    .values({
      userId: owner.id,
      title: values.title ?? "Section",
      position: values.position ?? "a5",
      isDefault: values.isDefault ?? false,
    })
    .returning();
  if (!row) throw new Error("insert section failed");
  return row;
}

/** The world a list permission fixture describes. */
export async function buildListFixture(
  db: Db,
  setup: { list: { deleted?: boolean }; actorRole: "creator" | "none" },
) {
  const actor = await makeUser(db, "Actor");
  const other = await makeUser(db, "Other");
  const list = await makeList(db, setup.actorRole === "creator" ? actor : other, {
    deleted: setup.list.deleted ?? false,
  });
  return { actor, list };
}

export async function buildSectionFixture(
  db: Db,
  setup: { section: { isDefault: boolean }; actorRole: "owner" | "none" },
) {
  const actor = await makeUser(db, "Actor");
  const other = await makeUser(db, "Other");
  const section = await makeSection(db, setup.actorRole === "owner" ? actor : other, {
    isDefault: setup.section.isDefault,
  });
  return { actor, section };
}

/** A task in no list (Inbox-only) created by `owner` directly in the database. */
export async function makeInboxOnlyTask(
  db: Db,
  owner: AuthUser,
  values: { title?: string; parentTaskId?: string; workspaceId?: string; deleted?: boolean } = {},
) {
  const workspaceId = values.workspaceId ?? (await makePersonalWorkspace(db, owner)).id;
  const title = values.title ?? "A task";
  const [row] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title,
      titleInline: [{ type: "text", text: title }],
      parentTaskId: values.parentTaskId ?? null,
      createdBy: owner.id,
      deletedAt: values.deleted ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error("insert task failed");
  return row;
}

/** The world a task permission fixture describes (a task in no list). */
export async function buildTaskFixture(
  db: Db,
  setup: { task: { deleted?: boolean }; actorRole: "creator" | "none" },
) {
  const actor = await makeUser(db, "Actor");
  const other = await makeUser(db, "Other");
  const task = await makeInboxOnlyTask(db, setup.actorRole === "creator" ? actor : other, {
    deleted: setup.task.deleted ?? false,
  });
  return { actor, task };
}
