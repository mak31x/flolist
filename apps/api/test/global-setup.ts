/**
 * Starts one Postgres for the whole test run and migrates a template database.
 * Each test file then clones the template (`createTestDb`), so files run in
 * parallel on isolated, already-migrated databases.
 *
 * Uses a Testcontainers Postgres (same image as dev, D-017). Set TEST_DATABASE_URL to
 * an admin URL of an existing server to skip the container.
 */
import { createDb, runMigrations } from "@flolist/db";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

export const TEMPLATE_DB = "flolist_test_template";
const IMAGE = "postgres:19.0-alpine";

declare module "vitest" {
  export interface ProvidedContext {
    /** Admin connection URL of the test server (database `postgres`). */
    pgAdminUrl: string;
    pgTemplateDb: string;
  }
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl = process.env.TEST_DATABASE_URL;

  if (!adminUrl) {
    container = await new PostgreSqlContainer(IMAGE).withDatabase("postgres").start();
    adminUrl = container.getConnectionUri();
  }

  const admin = createDb(adminUrl, { max: 1 });
  await admin.pool.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
  await admin.pool.query(`create database ${TEMPLATE_DB}`);
  await admin.close();

  const template = createDb(withDatabase(adminUrl, TEMPLATE_DB), { max: 1 });
  await runMigrations(template.db);
  await template.close();

  project.provide("pgAdminUrl", adminUrl);
  project.provide("pgTemplateDb", TEMPLATE_DB);

  return async () => {
    await container?.stop();
  };
}
