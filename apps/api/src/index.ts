import { createDb } from "@flolist/db";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createApp } from "./app.ts";
import { createAuth, sessionResolver } from "./auth/auth.ts";
import { createSmtpMailer } from "./email/mailer.ts";
import { loadEnv } from "./env.ts";
import { createLogger } from "./lib/logger.ts";

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

const auth = createAuth({
  db: database.db,
  mailer: createSmtpMailer(env),
  logger,
  appUrl: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  google,
});

const app = createApp({
  db: database.db,
  logger,
  auth,
  resolveUser: sessionResolver(auth),
  appUrl: env.APP_URL,
  googleSignIn: google !== undefined,
  rateLimit: { limit: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
  authRateLimit: { limit: env.AUTH_RATE_LIMIT_MAX, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS },
  clientKey: clientIp,
  exposeErrors: env.NODE_ENV === "development",
});

const server = serve({ fetch: app.fetch, hostname: env.API_HOST, port: env.API_PORT }, (info) => {
  logger.info(`listening on http://${info.address}:${info.port}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
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
