import { apiErrorSchema, healthResponseSchema } from "@flolist/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await createApp().request("/api/health");
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe("ok");
  });
});

describe("unknown routes", () => {
  it("return the standard NOT_FOUND error", async () => {
    const res = await createApp().request("/api/nope");
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("loadEnv", () => {
  it("applies defaults", () => {
    expect(loadEnv({})).toMatchObject({ API_PORT: 3000, NODE_ENV: "development" });
  });

  it("rejects an invalid port", () => {
    expect(() => loadEnv({ API_PORT: "abc" })).toThrow(/Invalid environment/);
  });
});
