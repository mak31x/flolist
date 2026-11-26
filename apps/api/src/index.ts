import { createDb } from "@flolist/db";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createApp } from "./app.ts";
import { createAuth, sessionResolver } from "./auth/auth.ts";
import { createSmtpMailer } from "./email/mailer.ts";
import { loadEnv, s3ConfigFrom } from "./env.ts";
import { createLogger } from "./lib/logger.ts";
import { Hub } from "./realtime/hub.ts";
import { createOutboxDrainer } from "./realtime/outbox.ts";
import { mountRealtime } from "./realtime/ws.ts";
import { createS3Storage } from "./storage/storage.ts";

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === "development" });
const database = createDb(env.DATABASE_URL);

function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return getConnInfo(c).remote.address ?? "unknown";
}

if (env.NODE_ENV === "production" && env.SMTP_USER === "") {
  logger.warn("SMTP_USER is empty: verification and reset emails will fail (D-032)");
}
const google =
  env.GOOGLE_CLIENT_ID !== "" && env.GOOGLE_CLIENT_SECRET !== ""
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : undefined;
if (!google) logger.info("Google sign-in is off (GOOGLE_CLIENT_ID/SECRET not set)");

const s3 = s3ConfigFrom(env);
if (!s3) logger.warn("S3 storage isn't configured: uploads will answer 503 (D-037)");

const auth = createAuth({
  db: database.db,
  mailer: createSmtpMailer(env),
  logger,
  appUrl: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  google,
});

const hub = new Hub();
const outbox = createOutboxDrainer(database.db, hub, logger);
const resolveUser = sessionResolver(auth);

const app = createApp({
  db: database.db,
  logger,
  auth,
  resolveUser,
  afterMutation: outbox.kick,
  appUrl: env.APP_URL,
  googleSignIn: google !== undefined,
  rateLimit: { limit: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
  authRateLimit: { limit: env.AUTH_RATE_LIMIT_MAX, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS },
  clientKey: clientIp,
  exposeErrors: env.NODE_ENV === "development",
  storage: s3 ? createS3Storage(s3) : null,
  directUpload: env.S3_DIRECT_UPLOAD,
  maxUploadBytes: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
  maxWorkspaceBytes:
    env.MAX_WORKSPACE_STORAGE_GB === undefined
      ? undefined
      : Math.floor(env.MAX_WORKSPACE_STORAGE_GB * 1024 ** 3),
  uploadRateLimit: { limit: env.UPLOAD_RATE_LIMIT_MAX, windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MS },
});

const realtime = mountRealtime(app, {
  db: database.db,
  hub,
  resolveUser,
  logger,
  appUrl: env.APP_URL,
});

const server = serve({ fetch: app.fetch, hostname: env.API_HOST, port: env.API_PORT }, (info) => {
  logger.info(`listening on http://${info.address}:${info.port}`);
});
realtime.injectWebSocket(server);
outbox.start();

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  outbox.stop();
  realtime.close();
  server.close(() => {
    void database.close().finally(() => process.exit(0));
  });
}
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
