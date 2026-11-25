import { apiErrorSchema, healthResponseSchema } from "@flolist/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { ApiException } from "./lib/errors.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import type { AppEnv } from "./types.ts";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await createApp().request("/api/health");
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe("ok");
  });

  it("sends a request id", async () => {
    const res = await createApp().request("/api/health");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("unknown routes", () => {
  it("return the standard NOT_FOUND error", async () => {
    const res = await createApp().request("/api/nope");
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("unexpected errors", () => {
  // A route that fails after createApp's middleware has run.
  function failingApp(exposeErrors: boolean) {
    const app = createApp({ exposeErrors });
    return app.route(
      "/",
      new Hono<AppEnv>().get("/api/boom", () => {
        throw new Error("db password is hunter2");
      }),
    );
  }

  it("return INTERNAL without leaking the message", async () => {
    const res = await failingApp(false).request("/api/boom");
    expect(res.status).toBe(500);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("include the message in development", async () => {
    const res = await failingApp(true).request("/api/boom");
    expect(JSON.stringify(await res.json())).toContain("hunter2");
  });
});

describe("rateLimit", () => {
  function limitedApp(now: () => number) {
    return new Hono<AppEnv>()
      .use(rateLimit({ limit: 2, windowMs: 60_000, key: () => "k", now }))
      .get("/", (c) => c.text("ok"))
      .onError((err, c) => {
        if (!(err instanceof ApiException)) throw err;
        for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
        return c.json({ error: { code: err.code, message: err.message } }, err.status);
      });
  }

  it("allows `limit` requests per window, then answers 429 with Retry-After", async () => {
    let t = 0;
    const app = limitedApp(() => t);
    expect((await app.request("/")).headers.get("RateLimit-Remaining")).toBe("1");
    expect((await app.request("/")).status).toBe(200);
    const blocked = await app.request("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(apiErrorSchema.parse(await blocked.json()).error.code).toBe("RATE_LIMITED");

    t = 60_000;
    expect((await app.request("/")).status).toBe(200);
  });

  it("is applied to /api/* by createApp", async () => {
    const app = createApp({ rateLimit: { limit: 1, windowMs: 60_000 } });
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/health")).status).toBe(429);
  });
});

describe("loadEnv", () => {
  it("applies defaults", () => {
    expect(loadEnv({})).toMatchObject({
      API_PORT: 3000,
      NODE_ENV: "development",
      TRUST_PROXY: false,
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadEnv({ API_PORT: "abc" })).toThrow(/Invalid environment/);
  });
});
