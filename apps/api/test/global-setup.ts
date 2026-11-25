/**
 * Starts one Postgres for the whole test run and migrates a template database.
 * Each test file then clones the template (`createTestDb`), so files run in
 * parallel on isolated, already-migrated databases.
 *
 * Uses a Testcontainers Postgres (same image as dev, D-017). Set TEST_DATABASE_URL to
 * an admin URL of an existing server to skip the container.
 *
 * Also starts a RustFS (D-018) for the upload tests and creates one bucket. Set
 * TEST_S3_ENDPOINT (with the dev keys) to use a running S3 server instead.
 */
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createDb, runMigrations } from "@flolist/db";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";

export const TEMPLATE_DB = "flolist_test_template";
const IMAGE = "postgres:19.0-alpine";
const S3_IMAGE = "rustfs/rustfs:1.0.6";
const S3_KEYS = { accessKeyId: "flolist-test", secretAccessKey: "flolist-test-secret" };
export const TEST_BUCKET = "flolist-test";

declare module "vitest" {
  export interface ProvidedContext {
    /** Admin connection URL of the test server (database `postgres`). */
    pgAdminUrl: string;
    pgTemplateDb: string;
    s3: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
  }
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function startS3(): Promise<{ endpoint: string; container?: StartedTestContainer }> {
  const existing = process.env.TEST_S3_ENDPOINT;
  if (existing) return { endpoint: existing };
  const container = await new GenericContainer(S3_IMAGE)
    .withEnvironment({
      RUSTFS_ACCESS_KEY: S3_KEYS.accessKeyId,
      RUSTFS_SECRET_KEY: S3_KEYS.secretAccessKey,
      RUSTFS_ADDRESS: ":9000",
      RUSTFS_CONSOLE_ENABLE: "false",
      RUSTFS_OBS_LOGGER_LEVEL: "error",
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  return {
    endpoint: `http://${container.getHost()}:${String(container.getMappedPort(9000))}`,
    container,
  };
}

async function createBucket(endpoint: string) {
  const s3 = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: S3_KEYS,
  });
  // RustFS can accept connections a moment before it serves S3 requests.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
      return;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl = process.env.TEST_DATABASE_URL;

  const [pg, s3] = await Promise.all([
    adminUrl
      ? Promise.resolve(undefined)
      : new PostgreSqlContainer(IMAGE).withDatabase("postgres").start(),
    startS3(),
  ]);
  if (pg) {
    container = pg;
    adminUrl = pg.getConnectionUri();
  }
  if (!adminUrl) throw new Error("no Postgres for the tests");
  await createBucket(s3.endpoint);

  const admin = createDb(adminUrl, { max: 1 });
  await admin.pool.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
  await admin.pool.query(`create database ${TEMPLATE_DB}`);
  await admin.close();

  const template = createDb(withDatabase(adminUrl, TEMPLATE_DB), { max: 1 });
  await runMigrations(template.db);
  await template.close();

  project.provide("pgAdminUrl", adminUrl);
  project.provide("pgTemplateDb", TEMPLATE_DB);
  project.provide("s3", {
    endpoint: s3.endpoint,
    region: "us-east-1",
    bucket: TEST_BUCKET,
    ...S3_KEYS,
  });

  return async () => {
    await Promise.all([container?.stop(), s3.container?.stop()]);
  };
}
