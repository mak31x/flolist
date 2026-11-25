import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { ApiException } from "../lib/errors.ts";
import type { AppEnv } from "../types.ts";

export interface RateLimitOptions {
  /** Max requests per key per window. */
  limit: number;
  windowMs: number;
  /** Key per client; defaults to the user id, else the client IP. */
  key: (c: Context<AppEnv>) => string;
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, in-memory rate limiter. Fine for the single API node (D-010);
 * move to Postgres or Redis if we ever scale out. Sends IETF `RateLimit-*` headers
 * and `Retry-After` on 429.
 */
export function rateLimit(options: RateLimitOptions) {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();

  return createMiddleware<AppEnv>(async (c, next) => {
    const t = now();
    if (t - lastSweep > options.windowMs) {
      for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
      lastSweep = t;
    }

    const key = options.key(c);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - t) / 1000));
    const headers = {
      "RateLimit-Limit": String(options.limit),
      "RateLimit-Remaining": String(Math.max(0, options.limit - bucket.count)),
      "RateLimit-Reset": String(resetSeconds),
    };

    if (bucket.count > options.limit) {
      throw new ApiException("RATE_LIMITED", "Too many requests, try again shortly", {
        headers: { ...headers, "Retry-After": String(resetSeconds) },
      });
    }

    await next();
    for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
  });
}
