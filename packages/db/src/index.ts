// Drizzle schema, migrations and seed arrive in M0.2.

/** Parses a Postgres connection string and returns its database name. */
export function databaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name) throw new Error("DATABASE_URL has no database name");
  return name;
}
