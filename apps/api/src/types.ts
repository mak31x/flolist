import type { Db } from "@flolist/db";
import type { Context } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import type { Logger } from "pino";

/** The signed-in user as the API sees it. Better Auth fills this in from M1.1. */
export interface AuthUser {
  id: string;
}

/**
 * Turns a request into the signed-in user, or `null`. Until Better Auth lands (M1.1)
 * the server uses `noUser` (so every protected route returns 401); tests inject their own.
 */
export type ResolveUser = (req: Request) => Promise<AuthUser | null>;

export const noUser: ResolveUser = () => Promise.resolve(null);

export interface AppEnv {
  Variables: RequestIdVariables & {
    log: Logger;
    /** Unset only in apps built without a database (unit tests); read it with `dbOf(c)`. */
    db: Db | undefined;
    user: AuthUser | null;
  };
}

/** The request's database, or a clear error if this app instance has none. */
export function dbOf(c: Context<AppEnv>): Db {
  const db = c.get("db");
  if (!db) throw new Error("No database configured for this app instance");
  return db;
}
