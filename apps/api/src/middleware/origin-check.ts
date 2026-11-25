import { createMiddleware } from "hono/factory";
import { forbidden } from "../lib/errors.ts";
import type { AppEnv } from "../types.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated mutations (architecture.md → Security). Better Auth
 * protects /api/auth itself; this covers /api/v1. Requests with `Authorization: Bearer`
 * (native shells) carry no ambient credentials, so they skip the check.
 */
export function originCheck(allowedOrigin: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const usesCookie = c.req.header("cookie") !== undefined;
    const usesBearer = c.req.header("authorization")?.startsWith("Bearer ") ?? false;
    if (!SAFE_METHODS.has(c.req.method) && usesCookie && !usesBearer) {
      if (c.req.header("origin") !== allowedOrigin) {
        throw forbidden("Cross-origin request blocked");
      }
    }
    await next();
  });
}
