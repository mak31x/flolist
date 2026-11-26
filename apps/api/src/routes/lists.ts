import { blocks, files, lists, listViewPrefs, sidebarEntries, workspaces } from "@flolist/db";
import {
  channel,
  clientMutationSchema,
  createListSchema,
  DEFAULT_LIST_VIEW_PREFS,
  duplicateListSchema,
  idParamSchema,
  isInlineImage,
  positionBetween,
  updateListSchema,
  updateListViewPrefsSchema,
  uuidv7,
  type CreateListResult,
  type DuplicateListResult,
  type ListIndex,
  type ListIndexItem,
  type ListViewPrefs,
} from "@flolist/shared";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
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
import { subtreeIds } from "../lists/tree.ts";
import type { Executor } from "@flolist/db";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { dbOf, type AppEnv } from "../types.ts";

const indexItem = (row: ListRow, lastOpenedAt: Date | null): ListIndexItem => ({
  ...listDto(row),
  lastOpenedAt: lastOpenedAt?.toISOString() ?? null,
});

export const listRoutes = new Hono<AppEnv>()
  /**
   * The caller's list index (All lists, sidebar titles, breadcrumbs): every list they can see,
   * sublists included (`parentListId` set; All lists shows roots only), newest first. A
   * collection route, so the query is scoped to the caller instead of calling `authorize()`
   * per row. Until sharing (M7.2) that means lists whose root they created.
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
      .where(
        and(
          sql`${lists.rootListId} in (select r.id from ${lists} r where r.created_by = ${user.id} and r.deleted_at is null)`,
          isNull(lists.deletedAt),
        ),
      )
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
        const { root, list } = await authorize(tx, user, "list.edit", { type: "list", id });
        const patch: Partial<Pick<ListRow, "title" | "emoji" | "coverFileId" | "coverBuiltin">> =
          {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.emoji !== undefined) patch.emoji = input.emoji;
        if (input.cover !== undefined) {
          const cover = input.cover;
          if (cover && "fileId" in cover) await requireCoverFile(tx, cover.fileId, list);
          patch.coverFileId = cover && "fileId" in cover ? cover.fileId : null;
          patch.coverBuiltin = cover && "builtin" in cover ? cover.builtin : null;
        }
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
        const { root, list } = await authorize(tx, user, "list.manage", { type: "list", id });
        const now = new Date();
        const removed = await tx
          .update(lists)
          .set({
            deletedAt: now,
            deletedBy: user.id,
            trashRootId: id,
            version: sql`${lists.version} + 1`,
          })
          .where(and(inArray(lists.id, await subtreeIds(tx, id)), isNull(lists.deletedAt)))
          .returning({ id: lists.id, version: lists.version });
        for (const r of removed) {
          await emit(listChannels(root), {
            op: "delete",
            entity: "list",
            id: r.id,
            version: r.version,
          });
        }
        // A sublist deleted from its own page takes its row in the parent along (same root).
        if (list.parentBlockId) {
          const [block] = await tx
            .update(blocks)
            .set({
              deletedAt: now,
              deletedBy: user.id,
              trashRootId: id,
              version: sql`${blocks.version} + 1`,
            })
            .where(and(eq(blocks.id, list.parentBlockId), isNull(blocks.deletedAt)))
            .returning({ id: blocks.id, version: blocks.version });
          if (block) {
            await emit([channel.list(root.id)], {
              op: "delete",
              entity: "block",
              id: block.id,
              version: block.version,
            });
          }
        }
        return { status: 200, body: { id } };
      });
    },
  )

  /**
   * Duplicate list (lists-and-blocks.md → Duplicate): an exact copy of the content, sublists
   * included, titled "<title> (copy)". It's private, and starred right below the original
   * when the caller had the original starred. Files are shared, not copied [assumption].
   * A duplicated sublist becomes a root list in the same workspace [assumption].
   */
  .post(
    "/:id/duplicate",
    validate("param", idParamSchema),
    validate("json", duplicateListSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        const { list: source } = await authorize(tx, user, "list.view", { type: "list", id });
        await authorize(tx, user, "workspace.createList", {
          type: "workspace",
          id: source.workspaceId,
        });
        const [taken] = await tx.select({ id: lists.id }).from(lists).where(eq(lists.id, input.id));
        if (taken) throw new ApiException("CONFLICT", "A list with this id already exists");

        const copy = await copyTree(tx, source, input.id, user.id);

        // Starred right below the original, in the same section.
        const [original] = await tx
          .select()
          .from(sidebarEntries)
          .where(and(eq(sidebarEntries.userId, user.id), eq(sidebarEntries.listId, id)));
        let entry: typeof sidebarEntries.$inferSelect | null = null;
        if (original) {
          const [next] = await tx
            .select({ position: sidebarEntries.position })
            .from(sidebarEntries)
            .where(
              and(
                eq(sidebarEntries.sectionId, original.sectionId),
                gt(
                  sql`${sidebarEntries.position} collate "C"`,
                  sql`${original.position} collate "C"`,
                ),
              ),
            )
            .orderBy(asc(sql`${sidebarEntries.position} collate "C"`))
            .limit(1);
          const [inserted] = await tx
            .insert(sidebarEntries)
            .values({
              userId: user.id,
              listId: copy.root.id,
              sectionId: original.sectionId,
              position: positionBetween(original.position, next?.position ?? null),
            })
            .returning();
          entry = inserted ?? null;
        }

        for (const row of copy.lists) {
          await emit(listChannels(copy.root), {
            op: "upsert",
            entity: "list",
            id: row.id,
            version: row.version,
            data: listDto(row),
          });
        }
        if (entry) {
          await emit([channel.user(user.id)], {
            op: "upsert",
            entity: "sidebarEntry",
            id: entry.listId,
            version: entry.version,
            data: entryDto(entry),
          });
        }
        const body: DuplicateListResult = {
          list: indexItem(copy.root, null),
          sidebarEntry: entry ? entryDto(entry) : null,
        };
        return { status: 201, body };
      });
    },
  )

  /** The caller's view settings for the list (filter/sort menu); defaults until changed. */
  .get("/:id/prefs", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = dbOf(c);
    const { user } = await authorize(db, c.get("user"), "list.view", { type: "list", id });
    const [row] = await db
      .select()
      .from(listViewPrefs)
      .where(and(eq(listViewPrefs.listId, id), eq(listViewPrefs.userId, user.id)));
    return c.json(row ? prefsDto(row) : DEFAULT_LIST_VIEW_PREFS);
  })

  .patch(
    "/:id/prefs",
    validate("param", idParamSchema),
    validate("json", updateListViewPrefsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { clientMutationId, ...fields } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        await authorize(tx, user, "list.view", { type: "list", id });
        const set: Partial<ListViewPrefs> = {};
        if (fields.sort !== undefined) set.sort = fields.sort;
        if (fields.hideCompleted !== undefined) set.hideCompleted = fields.hideCompleted;
        if (fields.tasksOnly !== undefined) set.tasksOnly = fields.tasksOnly;
        const [row] = await tx
          .insert(listViewPrefs)
          .values({ userId: user.id, listId: id, ...set })
          .onConflictDoUpdate({
            target: [listViewPrefs.userId, listViewPrefs.listId],
            set: { ...set, updatedAt: new Date() },
          })
          .returning();
        if (!row) throw new Error("prefs upsert failed");
        const body = prefsDto(row);
        await emit([channel.user(user.id)], {
          op: "upsert",
          entity: "listPrefs",
          id,
          version: row.updatedAt.getTime(),
          data: body,
        });
        return { status: 200, body };
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

const prefsDto = (row: typeof listViewPrefs.$inferSelect): ListViewPrefs => ({
  sort: row.sort,
  hideCompleted: row.hideCompleted,
  tasksOnly: row.tasksOnly,
});

/** An uploaded cover: a ready image in the list's workspace. */
async function requireCoverFile(db: Executor, fileId: string, list: ListRow): Promise<void> {
  const [file] = await db
    .select({ mime: files.mime, workspaceId: files.workspaceId, status: files.status })
    .from(files)
    .where(eq(files.id, fileId));
  if (file?.status !== "ready" || file.workspaceId !== list.workspaceId) throw notFound("File");
  if (!isInlineImage(file.mime)) {
    throw new ApiException("VALIDATION", "A cover must be a JPEG, PNG, WebP or GIF image");
  }
}

/**
 * Copies `source` and its sublists (live rows only) with fresh ids; `rootId` becomes the new
 * root. Blocks keep their positions, types and content; sublist blocks point at the copies.
 */
async function copyTree(
  tx: Executor,
  source: ListRow,
  rootId: string,
  userId: string,
): Promise<{ root: ListRow; lists: ListRow[] }> {
  const ids = await subtreeIds(tx, source.id);
  const sourceLists = await tx.select().from(lists).where(inArray(lists.id, ids));
  const listIds = new Map<string, string>(
    ids.map((old) => [old, old === source.id ? rootId : uuidv7()]),
  );
  const sourceBlocks = await tx
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.containerType, "list"),
        inArray(blocks.containerId, ids),
        isNull(blocks.deletedAt),
      ),
    );
  const blockIds = new Map<string, string>(sourceBlocks.map((b) => [b.id, uuidv7()]));
  const mapped = (map: Map<string, string>, old: string | null) =>
    old === null ? null : (map.get(old) ?? null);

  // Parents before children (subtreeIds walks top-down), without parent blocks yet: the
  // blocks reference the lists and the lists reference the blocks.
  const byId = new Map(sourceLists.map((l) => [l.id, l]));
  const created: ListRow[] = [];
  for (const old of ids) {
    const l = byId.get(old);
    const newId = listIds.get(old);
    if (!l || !newId) continue;
    const isTop = old === source.id;
    const [row] = await tx
      .insert(lists)
      .values({
        id: newId,
        workspaceId: source.workspaceId,
        rootListId: rootId,
        parentListId: isTop ? null : mapped(listIds, l.parentListId),
        title: isTop ? `${l.title} (copy)` : l.title,
        emoji: l.emoji,
        coverFileId: l.coverFileId,
        coverBuiltin: l.coverBuiltin,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new Error("copy list failed");
    created.push(row);
  }

  const live = sourceBlocks.filter((b) => b.sublistId === null || listIds.has(b.sublistId));
  for (let i = 0; i < live.length; i += 500) {
    await tx.insert(blocks).values(
      live.slice(i, i + 500).map((b) => ({
        id: blockIds.get(b.id) ?? uuidv7(),
        containerType: "list" as const,
        containerId: listIds.get(b.containerId) ?? rootId,
        rootListId: rootId,
        position: b.position,
        type: b.type,
        indent: b.indent,
        content: b.content,
        fileId: b.fileId,
        sublistId: mapped(listIds, b.sublistId),
        createdBy: userId,
      })),
    );
  }

  const finished: ListRow[] = [];
  for (const row of created) {
    const old = sourceLists.find((l) => listIds.get(l.id) === row.id);
    const parentBlockId = mapped(blockIds, old?.parentBlockId ?? null);
    if (row.id === rootId || !parentBlockId) {
      finished.push(row);
      continue;
    }
    const [updated] = await tx
      .update(lists)
      .set({ parentBlockId })
      .where(eq(lists.id, row.id))
      .returning();
    finished.push(updated ?? row);
  }
  const root = finished.find((l) => l.id === rootId);
  if (!root) throw new Error("copy root missing");
  return { root, lists: finished };
}
