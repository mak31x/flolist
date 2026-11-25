import { createDb, requireDatabaseUrl, runMigrations } from "../src/index.ts";

const handle = createDb(requireDatabaseUrl(), { max: 1 });
try {
  await runMigrations(handle.db);
  console.log("[db] migrations applied");
} finally {
  await handle.close();
}
