import { lists, type Executor } from "@flolist/db";
import { sql } from "drizzle-orm";

/**
 * The list and every sublist below it (any depth), following `parent_list_id`. Includes
 * soft-deleted rows only when `withDeleted` is set (restores look for them).
 */
export async function subtreeIds(db: Executor, id: string, withDeleted = false): Promise<string[]> {
  const live = withDeleted ? sql`true` : sql`${lists.deletedAt} is null`;
  const result = await db.execute<{ id: string }>(sql`
    with recursive tree(id) as (
      select ${lists.id} from ${lists} where ${lists.id} = ${id} and ${live}
      union all
      select l.id from ${lists} l join tree t on l.parent_list_id = t.id
      where ${withDeleted ? sql`true` : sql`l.deleted_at is null`}
    )
    select id from tree
  `);
  return result.rows.map((r) => r.id);
}
