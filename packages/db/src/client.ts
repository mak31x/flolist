import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A database or an open transaction: what query helpers that may run inside one accept. */
export type Executor = PgDatabase<NodePgQueryResultHKT, Schema>;
/** The `tx` handed to `db.transaction()` callbacks. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Opens a pooled connection. Callers own the handle and must `close()` it. */
export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
