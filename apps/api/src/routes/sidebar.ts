import { lists, sections, sidebarEntries } from "@flolist/db";
import {
  channel,
  clientMutationSchema,
  createSectionSchema,
  idParamSchema,
  listIdParamSchema,
  putSidebarEntrySchema,
  updateSectionSchema,
  type Sidebar,
} from "@flolist/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { authorize, type SectionRow } from "../authz/authorize.ts";
import { ApiException, notFound, unauthenticated } from "../lib/errors.ts";
import { byKey, ensureDefaultSection, entryDto, sectionDto } from "../lists/dto.ts";
import { validate } from "../middleware/validate.ts";
import { runMutation } from "../sync/mutation.ts";
import { dbOf, type AppEnv } from "../types.ts";

/** Upper bound on sections per user, so a buggy client can't flood the sidebar [assumption]. */
export const MAX_SECTIONS = 200;

/**
 * The caller's sidebar (views.md → Sidebar): sections and starred entries, both sorted by
 * position. Sidebar state is per user, so these routes only ever touch the caller's rows.
 */
export const sidebarRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) throw unauthenticated();
    const db = dbOf(c);
    await ensureDefaultSection(db, user.id);
    const sectionRows = await db
      .select()
      .from(sections)
      .where(eq(sections.userId, user.id))
      .orderBy(asc(byKey(sections.position)), asc(sections.id));
    // Entries of lists in Trash are kept for restore but not shown.
    const entryRows = await db
      .select({ entry: sidebarEntries })
      .from(sidebarEntries)
      .innerJoin(lists, eq(lists.id, sidebarEntries.listId))
      .where(and(eq(sidebarEntries.userId, user.id), isNull(lists.deletedAt)))
      .orderBy(asc(byKey(sidebarEntries.position)), asc(sidebarEntries.listId));
    const body: Sidebar = {
      sections: sectionRows.map(sectionDto),
      entries: entryRows.map((r) => entryDto(r.entry)),
    };
    return c.json(body);
  })

  /** Stars a list into a section, or moves its entry to another place or section. */
  .put(
    "/entries/:listId",
    validate("param", listIdParamSchema),
    validate("json", putSidebarEntrySchema),
    async (c) => {
      const { listId } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        await authorize(tx, user, "list.view", { type: "list", id: listId });
        await authorize(tx, user, "section.update", { type: "section", id: input.sectionId });
        const [entry] = await tx
          .insert(sidebarEntries)
          .values({
            userId: user.id,
            listId,
            sectionId: input.sectionId,
            position: input.position,
          })
          .onConflictDoUpdate({
            target: [sidebarEntries.userId, sidebarEntries.listId],
            set: {
              sectionId: input.sectionId,
              position: input.position,
              version: sql`${sidebarEntries.version} + 1`,
            },
          })
          .returning();
        if (!entry) throw new Error("upsert sidebar entry failed");
        await emit([channel.user(user.id)], {
          op: "upsert",
          entity: "sidebarEntry",
          id: listId,
          version: entry.version,
          data: entryDto(entry),
        });
        return { status: 200, body: entryDto(entry) };
      });
    },
  )

  /** Unstars a list: it leaves the sidebar but stays in All lists. */
  .delete(
    "/entries/:listId",
    validate("param", listIdParamSchema),
    validate("json", clientMutationSchema),
    async (c) => {
      const { listId } = c.req.valid("param");
      const { clientMutationId } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        const [removed] = await tx
          .delete(sidebarEntries)
          .where(and(eq(sidebarEntries.userId, user.id), eq(sidebarEntries.listId, listId)))
          .returning();
        if (!removed) throw notFound("Sidebar entry");
        await emit([channel.user(user.id)], {
          op: "delete",
          entity: "sidebarEntry",
          id: listId,
          version: removed.version + 1,
        });
        return { status: 200, body: { listId } };
      });
    },
  );

const sectionEvent = (row: SectionRow) =>
  ({
    op: "upsert",
    entity: "section",
    id: row.id,
    version: row.version,
    data: sectionDto(row),
  }) as const;

/** The user's own sidebar sections (lists-and-blocks.md → Sections and favorites). */
export const sectionRoutes = new Hono<AppEnv>()
  .post("/", validate("json", createSectionSchema), async (c) => {
    const input = c.req.valid("json");
    return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sections)
        .where(eq(sections.userId, user.id));
      if ((count?.n ?? 0) >= MAX_SECTIONS) {
        throw new ApiException("LIMIT", `You can have up to ${String(MAX_SECTIONS)} sections`);
      }
      const [row] = await tx
        .insert(sections)
        .values({ id: input.id, userId: user.id, title: input.title, position: input.position })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ApiException("CONFLICT", "A section with this id already exists");
      await emit([channel.user(user.id)], sectionEvent(row));
      return { status: 201, body: sectionDto(row) };
    });
  })

  .patch(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateSectionSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return runMutation(c, input.clientMutationId, async ({ tx, user, emit }) => {
        await authorize(tx, user, "section.update", { type: "section", id });
        const patch: Partial<Pick<SectionRow, "title" | "collapsed" | "position">> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.collapsed !== undefined) patch.collapsed = input.collapsed;
        if (input.position !== undefined) patch.position = input.position;
        const [row] = await tx
          .update(sections)
          .set({ ...patch, version: sql`${sections.version} + 1` })
          .where(eq(sections.id, id))
          .returning();
        if (!row) throw new Error(`section ${id} vanished during update`);
        await emit([channel.user(user.id)], sectionEvent(row));
        return { status: 200, body: sectionDto(row) };
      });
    },
  )

  /** Deletes a section; its lists leave the sidebar but are never deleted. */
  .delete(
    "/:id",
    validate("param", idParamSchema),
    validate("json", clientMutationSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { clientMutationId } = c.req.valid("json");
      return runMutation(c, clientMutationId, async ({ tx, user, emit }) => {
        const { section } = await authorize(tx, user, "section.delete", { type: "section", id });
        const entries = await tx
          .delete(sidebarEntries)
          .where(eq(sidebarEntries.sectionId, id))
          .returning();
        await tx.delete(sections).where(eq(sections.id, id));
        const userChannel = [channel.user(user.id)];
        for (const e of entries) {
          await emit(userChannel, {
            op: "delete",
            entity: "sidebarEntry",
            id: e.listId,
            version: e.version + 1,
          });
        }
        await emit(userChannel, {
          op: "delete",
          entity: "section",
          id,
          version: section.version + 1,
        });
        return { status: 200, body: { id } };
      });
    },
  );
