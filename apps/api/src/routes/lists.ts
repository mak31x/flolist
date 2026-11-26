import { lists, listViewPrefs, sidebarEntries, workspaces } from "@flolist/db";
import {
  clientMutationSchema,
  createListSchema,
  idParamSchema,
  updateListSchema,
  type CreateListResult,
  type ListIndex,
  type ListIndexItem,
} from "@flolist/shared";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize, type ListRow } from "../authz/authorize.ts";
import { ApiException, notFound, unauthenticated } from "../lib/errors.ts";
import {
  ensureDefaultSection,
  entryDto,
  listChannels,
  listDto,
  nextEntryPosition,
} from "../lists/dto.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { dbOf, type AppEnv } from "../types.ts";

const indexItem = (row: ListRow, lastOpenedAt: Date | null): ListIndexItem => ({
  ...listDto(row),
  lastOpenedAt: lastOpenedAt?.toISOString() ?? null,
});

export const listRoutes = new Hono<AppEnv>()
  /**
   * The caller's list index (All lists, sidebar titles): root lists they can see, newest first.
   * A collection route, so the query is scoped to the caller instead of calling `authorize()`
   * per row. Until sharing (M7.2) that means lists they created.
   */
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) throw unauthenticated();
    const rows = await dbOf(c)
      .select({ list: lists, lastOpenedAt: listViewPrefs.lastOpenedAt })
      .from(lists)
      .leftJoin(
        listViewPrefs,
        and(eq(listViewPrefs.listId, lists.id), eq(listViewPrefs.userId, user.id)),
      )
      .where(and(eq(lists.createdBy, user.id), isNull(lists.parentListId), isNull(lists.deletedAt)))
      .orderBy(desc(lists.createdAt), desc(lists.id));
    const body: ListIndex = { items: rows.map((r) => indexItem(r.list, r.lastOpenedAt)) };
    return c.json(body);
  })

  /**
   * Creates a list (lists-and-blocks.md → Lists): Personal unless `workspaceId` says otherwise,
   * and starred into Favorites (or the given section) like Superlist does.
   */
  .post("/", validate("json", createListSchema), async (c) => {
    const input = c.req.valid("json");
    return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
      let workspaceId = input.workspaceId;
      if (!workspaceId) {
        const [personal] = await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(
            and(
              eq(workspaces.kind, "personal"),
              eq(workspaces.ownerId, user.id),
              isNull(workspaces.deletedAt),
            ),
          )
          .limit(1);
        if (!personal) throw notFound("Workspace");
        workspaceId = personal.id;
      }
      await authorize(tx, user, "workspace.createList", { type: "workspace", id: workspaceId });

      const section = input.sectionId
        ? (await authorize(tx, user, "section.update", { type: "section", id: input.sectionId }))
            .section
        : await ensureDefaultSection(tx, user.id);

      const [list] = await tx
        .insert(lists)
        .values({
          id: input.id,
          workspaceId,
          rootListId: input.id,
          title: input.title,
          emoji: input.emoji ?? null,
          createdBy: user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!list) throw new ApiException("CONFLICT", "A list with this id already exists");

      const [entry] = await tx
        .insert(sidebarEntries)
        .values({
          userId: user.id,
          listId: list.id,
          sectionId: section.id,
          position: input.position ?? (await nextEntryPosition(tx, section.id)),
        })
        .returning();
      if (!entry) throw new Error("insert sidebar entry failed");

      await emit(listChannels(list), {
        op: "upsert",
        entity: "list",
        id: list.id,
        version: list.version,
        data: listDto(list),
      });
      await emit([`user:${user.id}`], {
        op: "upsert",
        entity: "sidebarEntry",
        id: list.id,
        version: entry.version,
        data: entryDto(entry),
      });
      const body: CreateListResult = { list: indexItem(list, null), sidebarEntry: entryDto(entry) };
      return { status: 201, body };
    });
  })

  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = dbOf(c);
    const { list, user } = await authorize(db, c.get("user"), "list.view", { type: "list", id });
    const [prefs] = await db
      .select({ lastOpenedAt: listViewPrefs.lastOpenedAt })
      .from(listViewPrefs)
      .where(and(eq(listViewPrefs.listId, id), eq(listViewPrefs.userId, user.id)))
      .limit(1);
    return c.json(indexItem(list, prefs?.lastOpenedAt ?? null));
  })

  /** Field-level PATCH (D-006): only the sent fields change; last write wins per field. */
  .patch(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateListSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const { root } = await authorize(tx, user, "list.edit", { type: "list", id });
        const patch: Partial<Pick<ListRow, "title" | "emoji">> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.emoji !== undefined) patch.emoji = input.emoji;
        const [updated] = await tx
          .update(lists)
          .set({ ...patch, version: sql`${lists.version} + 1` })
          .where(eq(lists.id, id))
          .returning();
        if (!updated) throw new Error(`list ${id} vanished during update`);
        await emit(listChannels(root), {
          op: "upsert",
          entity: "list",
          id,
          version: updated.version,
          data: listDto(updated),
        });
        const [prefs] = await tx
          .select({ lastOpenedAt: listViewPrefs.lastOpenedAt })
          .from(listViewPrefs)
          .where(and(eq(listViewPrefs.listId, id), eq(listViewPrefs.userId, user.id)))
          .limit(1);
        return { status: 200, body: indexItem(updated, prefs?.lastOpenedAt ?? null) };
      });
    },
  )

  /**
   * Moves the list and everything under it to Trash (one trash root; lists-and-blocks.md →
   * Delete). Sidebar entries stay so a restore (M6.1) puts the list back where it was.
   */
  .delete(
    "/:id",
    validate("param", idParamSchema),
    validate("json", clientMutationSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { clientMutationId } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        const { root } = await authorize(tx, user, "list.manage", { type: "list", id });
        const removed = await tx
          .update(lists)
          .set({
            deletedAt: new Date(),
            deletedBy: user.id,
            trashRootId: id,
            version: sql`${lists.version} + 1`,
          })
          .where(and(or(eq(lists.id, id), eq(lists.rootListId, id)), isNull(lists.deletedAt)))
          .returning({ id: lists.id, version: lists.version });
        for (const r of removed) {
          await emit(listChannels(root), {
            op: "delete",
            entity: "list",
            id: r.id,
            version: r.version,
          });
        }
        return { status: 200, body: { id } };
      });
    },
  )

  /** Records that the caller opened the list (All lists → sort by Last opened). */
  .post("/:id/open", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = dbOf(c);
    const { user } = await authorize(db, c.get("user"), "list.view", { type: "list", id });
    const now = new Date();
    await db
      .insert(listViewPrefs)
      .values({ userId: user.id, listId: id, lastOpenedAt: now })
      .onConflictDoUpdate({
        target: [listViewPrefs.userId, listViewPrefs.listId],
        set: { lastOpenedAt: now },
      });
    return c.body(null, 204);
  });
