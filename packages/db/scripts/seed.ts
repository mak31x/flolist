import { createDb, requireDatabaseUrl, seed } from "../src/index.ts";

const handle = createDb(requireDatabaseUrl(), { max: 1 });
try {
  await seed(handle.db);
  console.log("[db] seed applied");
} finally {
  await handle.close();
}
