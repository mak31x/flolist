// Production migration entry: `node dist/migrate.js` (the deploy job runs it before restarting the api).
// In the bundle, @flolist/db resolves its migrations folder as `../migrations` next to `dist/`,
// so the image copies packages/db/migrations to /app/migrations.
import { createDb, requireDatabaseUrl, runMigrations } from "@flolist/db";

const handle = createDb(requireDatabaseUrl(), { max: 1 });
try {
  await runMigrations(handle.db);
  console.log("[db] migrations applied");
} finally {
  await handle.close();
}
