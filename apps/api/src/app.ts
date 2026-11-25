import type { Db } from "@flolist/db";
import type { HealthResponse } from "@flolist/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { Logger } from "pino";
import { ApiException, errorResponse } from "./lib/errors.ts";
import { silentLogger } from "./lib/logger.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import { requestLog } from "./middleware/request-log.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { noUser, type AppEnv, type ResolveUser } from "./types.ts";

export interface AppDeps {
  /** Omit only in tests that never touch the database. */
  db?: Db;
  resolveUser?: ResolveUser;
  logger?: Logger;
  rateLimit?: { limit: number; windowMs: number };
  /** Client key for rate limiting when there's no user (normally the client IP). */
  clientKey?: (c: Context<AppEnv>) => string;
  /** Include the real message and stack of unexpected errors (development only). */
  exposeErrors?: boolean;
}

export function createApp(deps: AppDeps = {}) {
  const logger = deps.logger ?? silentLogger;
  const resolveUser = deps.resolveUser ?? noUser;
  const clientKey = deps.clientKey ?? (() => "anonymous");
  const { db } = deps;

  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(requestLog(logger));
  app.use("/api/*", async (c, next) => {
    if (db) c.set("db", db);
    c.set("user", await resolveUser(c.req.raw));
    await next();
  });
  app.use(
    "/api/*",
    rateLimit({
      limit: deps.rateLimit?.limit ?? 300,
      windowMs: deps.rateLimit?.windowMs ?? 60_000,
      key: (c) => {
        const user = c.get("user");
        return user ? `user:${user.id}` : `ip:${clientKey(c)}`;
      },
    }),
  );

  app.get("/api/health", (c) => {
    const body: HealthResponse = { status: "ok", service: "api", time: new Date().toISOString() };
    return c.json(body);
  });

  app.route("/api/v1/workspaces", workspaceRoutes);

  app.notFound((c) => errorResponse(c, "NOT_FOUND", "Route not found"));

  app.onError((err, c) => {
    if (err instanceof ApiException) {
      for (const [name, value] of Object.entries(err.headers)) c.header(name, value);
      return errorResponse(c, err.code, err.message, err.details);
    }
    // Hono raises these itself, e.g. for a body that isn't valid JSON.
    if (err instanceof HTTPException && err.status < 500) {
      return errorResponse(c, "VALIDATION", err.message || "The request is invalid");
    }
    const log = (c.get("log") as Logger | undefined) ?? logger;
    log.error({ err }, "unhandled error");
    const details = deps.exposeErrors ? { message: err.message, stack: err.stack } : undefined;
    return errorResponse(c, "INTERNAL", "Something went wrong on our side", details);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
