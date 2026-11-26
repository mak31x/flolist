import type { Executor } from "@flolist/db";
import { sections, sidebarEntries } from "@flolist/db";
import {
  channel,
  DEFAULT_SECTION_TITLE,
  positionAfter,
  type List,
  type Section,
  type SidebarEntry,
} from "@flolist/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ListRow, SectionRow } from "../authz/authorize.ts";

export function listDto(row: ListRow): List {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    rootListId: row.rootListId,
    parentListId: row.parentListId,
    title: row.title,
    emoji: row.emoji,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function sectionDto(row: SectionRow): Section {
  return {
    id: row.id,
    title: row.title,
    position: row.position,
    collapsed: row.collapsed,
    isDefault: row.isDefault,
    version: row.version,
  };
}

export function entryDto(row: typeof sidebarEntries.$inferSelect): SidebarEntry {
  return {
    listId: row.listId,
    sectionId: row.sectionId,
    position: row.position,
    version: row.version,
  };
}

/**
 * Who hears about a list change: the root's creator (their list index and sidebar) and anyone
 * with the list open. Sharing (M7.2) adds collaborators' user channels and member teams.
 */
export function listChannels(root: ListRow): string[] {
  return [channel.user(root.createdBy), channel.list(root.rootListId)];
}

/** Byte-order sort for fractional keys (D-008). */
export const byKey = (col: typeof sections.position | typeof sidebarEntries.position) =>
  sql`${col} collate "C"`;

/**
 * The user's "Favorites" section, created on first use. Idempotent (a partial unique index
 * allows one default section per user), so concurrent first requests are safe.
 */
export async function ensureDefaultSection(db: Executor, userId: string): Promise<SectionRow> {
  await db
    .insert(sections)
    .values({
      userId,
      title: DEFAULT_SECTION_TITLE,
      position: positionAfter(null),
      isDefault: true,
    })
    .onConflictDoNothing({ target: sections.userId, where: sql`${sections.isDefault}` });
  const [row] = await db
    .select()
    .from(sections)
    .where(and(eq(sections.userId, userId), eq(sections.isDefault, true)))
    .limit(1);
  if (!row) throw new Error(`default section for ${userId} is missing`);
  return row;
}

/** A key after the last entry in a section. */
export async function nextEntryPosition(db: Executor, sectionId: string): Promise<string> {
  const [last] = await db
    .select({ position: sidebarEntries.position })
    .from(sidebarEntries)
    .where(eq(sidebarEntries.sectionId, sectionId))
    .orderBy(desc(byKey(sidebarEntries.position)))
    .limit(1);
  return positionAfter(last?.position ?? null);
}
