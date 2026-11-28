import { inboxItems, lists, tasks, type Executor } from "@flolist/db";
import { channel } from "@flolist/shared";
import { inArray, sql } from "drizzle-orm";

/**
 * Who hears about a task outside the list page (M4.1): the views that query across lists
 * (Inbox, Today) aren't subscribed to every `list:<rootId>`, so task events also go to
 * `user:<id>` of everyone who can see the task. Until sharing (M7.2) and assigning (M7.3)
 * that is the root list's creator for a task in a list, the top-level task's creator for an
 * Inbox-only task, plus every user who has the task (or its top-level task) in their Inbox.
 * The hub sends an event once per connection, so overlapping channels don't duplicate it.
 */

/** Each task's top-level task (itself when it has no parent), live or not. */
export async function topTaskIds(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const result = await db.execute<{ origin: string; top: string }>(sql`
    with recursive up(id, parent, origin, hops) as (
      select ${tasks.id}, ${tasks.parentTaskId}, ${tasks.id}, 0 from ${tasks}
      where ${inArray(tasks.id, [...new Set(ids)])}
      union all
      select t.id, t.parent_task_id, up.origin, up.hops + 1
      from ${tasks} t join up on t.id = up.parent
      where up.hops < 16
    )
    select origin, id as top from up where parent is null
  `);
  for (const r of result.rows) out.set(r.origin, r.top);
  return out;
}

/** The channels each task's events go to. */
export async function taskChannels(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const tops = await topTaskIds(db, unique);
  const related = [...new Set([...unique, ...tops.values()])];
  const rows = await db
    .select({
      id: tasks.id,
      rootListId: tasks.rootListId,
      createdBy: tasks.createdBy,
      rootCreator: lists.createdBy,
    })
    .from(tasks)
    .leftJoin(lists, sql`${lists.id} = ${tasks.rootListId}`)
    .where(inArray(tasks.id, related));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const holders = await db
    .select({ taskId: inboxItems.taskId, userId: inboxItems.userId })
    .from(inboxItems)
    .where(inArray(inboxItems.taskId, related));
  const holdersOf = new Map<string, string[]>();
  for (const h of holders) holdersOf.set(h.taskId, [...(holdersOf.get(h.taskId) ?? []), h.userId]);

  for (const id of unique) {
    const row = byId.get(id);
    if (!row) continue;
    const top = byId.get(tops.get(id) ?? id) ?? row;
    const users = new Set<string>([...(holdersOf.get(id) ?? []), ...(holdersOf.get(top.id) ?? [])]);
    const owner = row.rootListId ? row.rootCreator : top.createdBy;
    if (owner) users.add(owner);
    out.set(id, [
      ...(row.rootListId ? [channel.list(row.rootListId)] : []),
      ...[...users].map((u) => channel.user(u)),
    ]);
  }
  return out;
}

/**
 * The channels of a block: its list's channel, or for a block in the body of an Inbox-only
 * task (no root list) the channels of the task it belongs to.
 */
export async function blockChannels(
  db: Executor,
  block: { rootListId: string | null; containerType: string; containerId: string },
): Promise<string[]> {
  if (block.rootListId) return [channel.list(block.rootListId)];
  if (block.containerType !== "task") return [];
  return (await taskChannels(db, [block.containerId])).get(block.containerId) ?? [];
}
