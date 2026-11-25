import { randomUUID } from "node:crypto";
import { createDb, type DbHandle } from "@flolist/db";
import { inject } from "vitest";

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export interface TestDb extends DbHandle {
  name: string;
  /** Closes the pool and drops the database. */
  drop: () => Promise<void>;
}

/** A fresh, migrated database cloned from the template made in global-setup.ts. */
export async function createTestDb(): Promise<TestDb> {
  const adminUrl = inject("pgAdminUrl");
  const template = inject("pgTemplateDb");
  const name = `t_${randomUUID().replaceAll("-", "")}`;

  const admin = createDb(adminUrl, { max: 1 });
  try {
    await admin.pool.query(`create database ${name} template ${template}`);
  } finally {
    await admin.close();
  }

  const handle = createDb(withDatabase(adminUrl, name), { max: 4 });
  return {
    ...handle,
    name,
    drop: async () => {
      await handle.close();
      const a = createDb(adminUrl, { max: 1 });
      try {
        await a.pool.query(`drop database if exists ${name} with (force)`);
      } finally {
        await a.close();
      }
    },
  };
}
