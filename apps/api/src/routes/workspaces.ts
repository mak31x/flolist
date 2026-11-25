import { member, workspaces } from "@flolist/db";
import {
  updateWorkspaceSchema,
  workspaceIdParamSchema,
  type Workspace,
  type WorkspaceList,
  type WorkspaceRole,
} from "@flolist/shared";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize, type WorkspaceRow } from "../authz/authorize.ts";
import { unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import { dbOf, type AppEnv } from "../types.ts";

function toDto(ws: WorkspaceRow, role: WorkspaceRole): Workspace {
  return {
    id: ws.id,
    kind: ws.kind,
    name: ws.name,
    emoji: ws.emoji,
    ownerId: ws.ownerId,
    role,
    version: ws.version,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  };
}

export const workspaceRoutes = new Hono<AppEnv>()
  /**
   * The caller's workspaces: their personal one first, then teams by name.
   * A collection route: the query itself is scoped to the caller's memberships,
   * so there's no single resource to pass to `authorize()`.
   */
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) throw unauthenticated();
    const rows = await dbOf(c)
      .select({ workspace: workspaces, memberRole: member.role })
      .from(workspaces)
      .leftJoin(
        member,
        and(eq(member.organizationId, workspaces.organizationId), eq(member.userId, user.id)),
      )
      .where(
        and(
          isNull(workspaces.deletedAt),
          or(
            and(eq(workspaces.kind, "personal"), eq(workspaces.ownerId, user.id)),
            and(eq(workspaces.kind, "team"), sql`${member.id} is not null`),
          ),
        ),
      )
      .orderBy(sql`${workspaces.kind} = 'team'`, asc(workspaces.name), asc(workspaces.id));

    const body: WorkspaceList = {
      items: rows.map((r) => toDto(r.workspace, r.memberRole ?? "owner")),
    };
    return c.json(body);
  })

  .get("/:id", validate("param", workspaceIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { workspace, role } = await authorize(dbOf(c), c.get("user"), "workspace.view", {
      type: "workspace",
      id,
    });
    return c.json(toDto(workspace, role));
  })

  /**
   * Field-level PATCH (D-006). With no other writers yet, last write wins per field;
   * `baseVersion` is accepted now so clients send it from day one. `clientMutationId`
   * dedupe arrives with the outbox in M2.1.
   */
  .patch(
    "/:id",
    validate("param", workspaceIdParamSchema),
    validate("json", updateWorkspaceSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = dbOf(c);
      const { role } = await authorize(db, c.get("user"), "workspace.update", {
        type: "workspace",
        id,
      });

      const patch: Partial<Pick<WorkspaceRow, "name" | "emoji">> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.emoji !== undefined) patch.emoji = input.emoji;

      const [updated] = await db
        .update(workspaces)
        .set({ ...patch, version: sql`${workspaces.version} + 1` })
        .where(eq(workspaces.id, id))
        .returning();
      if (!updated) throw new Error(`workspace ${id} vanished during update`);
      return c.json(toDto(updated, role));
    },
  );
