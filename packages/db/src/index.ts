export * from "./client.ts";
export * from "./migrate.ts";
export * from "./schema/index.ts";
export { seed, seedIds } from "./seed.ts";

/** Parses a Postgres connection string and returns its database name. */
export function databaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name) throw new Error("DATABASE_URL has no database name");
  return name;
}

/** Reads DATABASE_URL or throws a readable error. */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  return url;
}
