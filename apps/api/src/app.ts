import type { Db } from "@flolist/db";
import { DEFAULT_MAX_UPLOAD_MB, type HealthResponse, type PublicConfig } from "@flolist/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { Logger } from "pino";
import { CLIENT_IP_HEADER, type Auth } from "./auth/auth.ts";
import { ApiException, errorResponse, unauthenticated } from "./lib/errors.ts";
import { silentLogger } from "./lib/logger.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import { originCheck } from "./middleware/origin-check.ts";
import { requestLog } from "./middleware/request-log.ts";
import { fileRoutes, uploadRoutes, type FileRoutesOptions } from "./routes/files.ts";
import { blockRoutes } from "./routes/blocks.ts";
import { labelRoutes } from "./routes/labels.ts";
import { listRoutes } from "./routes/lists.ts";
import { meRoutes } from "./routes/me.ts";
import { sectionRoutes, sidebarRoutes } from "./routes/sidebar.ts";
import { taskRoutes } from "./routes/tasks.ts";
import type { Storage } from "./storage/storage.ts";
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
  /** Better Auth; mounted at /api/auth/* when given. */
  auth?: Auth;
  /** Stricter per-IP limit on sign-in, sign-up, reset and verification-email requests. */
  authRateLimit?: { limit: number; windowMs: number };
  /** APP_URL; cookie-authenticated mutations must come from this origin. */
  appUrl?: string;
  /** Whether Google OAuth keys are configured (shown on the sign-in screens). */
  googleSignIn?: boolean;
  /** Object storage; uploads and downloads answer 503 without it. */
  storage?: Storage | null;
  /** Per-file limit in bytes (default 25 MB, D-013). */
  maxUploadBytes?: number;
  /** Per-workspace storage limit in bytes; undefined = unlimited. */
  maxWorkspaceBytes?: number | undefined;
  /** Browsers PUT to presigned storage URLs instead of through the API (needs bucket CORS). */
  directUpload?: boolean;
  /** Upload reservations per user (default 30 per minute). */
  uploadRateLimit?: { limit: number; windowMs: number };
  /** Runs after every committed mutation; the server passes the outbox drainer's `kick`. */
  afterMutation?: () => void;
}

/** Auth endpoints that send email or check a password get the stricter limit. */
const SENSITIVE_AUTH_PATHS = [
  "/api/auth/sign-in/*",
  "/api/auth/sign-up/*",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
  "/api/auth/send-verification-email",
  "/api/auth/change-password",
];

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
    c.set("afterMutation", deps.afterMutation);
    // Better Auth reads its own session on /api/auth; don't look it up twice.
    const isAuthRoute = c.req.path.startsWith("/api/auth/");
    c.set("user", isAuthRoute ? null : await resolveUser(c.req.raw));
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

  const authLimiter = rateLimit({
    limit: deps.authRateLimit?.limit ?? 10,
    windowMs: deps.authRateLimit?.windowMs ?? 60_000,
    key: (c) => `auth-ip:${clientKey(c)}`,
  });
  app.on("POST", SENSITIVE_AUTH_PATHS, authLimiter);

  const uploadLimiter = rateLimit({
    limit: deps.uploadRateLimit?.limit ?? 30,
    windowMs: deps.uploadRateLimit?.windowMs ?? 60_000,
    key: (c) => {
      const user = c.get("user");
      return user ? `upload-user:${user.id}` : `upload-ip:${clientKey(c)}`;
    },
  });
  app.on("POST", "/api/v1/uploads", uploadLimiter);

  if (deps.auth) {
    const { auth } = deps;
    app.on(["GET", "POST"], "/api/auth/*", (c) => {
      // Replace any client-sent value: Better Auth trusts this header for the session IP.
      const headers = new Headers(c.req.raw.headers);
      headers.set(CLIENT_IP_HEADER, clientKey(c));
      return auth.handler(new Request(c.req.raw, { headers }));
    });
  }

  // Every /api/v1 route needs a signed-in user; answer 401 before validation runs.
  app.use("/api/v1/*", async (c, next) => {
    if (!c.get("user")) throw unauthenticated();
    await next();
  });
  if (deps.appUrl) app.use("/api/v1/*", originCheck(new URL(deps.appUrl).origin));

  app.get("/api/health", (c) => {
    const body: HealthResponse = { status: "ok", service: "api", time: new Date().toISOString() };
    return c.json(body);
  });

  /** Public: what the signed-out screens need to render. No user data. */
  app.get("/api/config", (c) => {
    const body: PublicConfig = { googleSignIn: deps.googleSignIn ?? false };
    return c.json(body);
  });

  const files: FileRoutesOptions = {
    storage: deps.storage ?? null,
    maxUploadBytes: deps.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_MB * 1024 * 1024,
    maxWorkspaceBytes: deps.maxWorkspaceBytes,
    directUpload: deps.directUpload ?? false,
  };
  app.route("/api/v1/me", meRoutes);
  app.route("/api/v1/uploads", uploadRoutes(files));
  app.route("/api/v1/files", fileRoutes(files));
  app.route("/api/v1/workspaces", workspaceRoutes);
  app.route("/api/v1/lists", listRoutes);
  app.route("/api/v1/lists", blockRoutes);
  app.route("/api/v1/tasks", taskRoutes);
  app.route("/api/v1/labels", labelRoutes);
  app.route("/api/v1/sections", sectionRoutes);
  app.route("/api/v1/sidebar", sidebarRoutes);

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
