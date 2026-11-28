import { sql } from "drizzle-orm";
import { customType, integer, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * UUIDv7 primary key. Clients normally send the id (D-006); Postgres 18+'s native
 * `uuidv7()` is the fallback for server-created rows and for Better Auth
 * (which runs with `advanced.database.generateId: false`, wired in M1.1).
 */
export const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Bumped on every update; used for field-level last-write-wins (D-006). */
export const version = () => integer("version").notNull().default(1);

/**
 * A fractional-index key stored with the "C" collation, so `order by position` and its index
 * sort byte-wise (D-041) without a `collate` in every query.
 */
export const positionText = customType<{ data: string }>({
  dataType: () => `text collate "C"`,
});
