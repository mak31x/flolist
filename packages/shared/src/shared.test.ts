import { describe, expect, it } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "./index.ts";

describe("healthResponseSchema", () => {
  it("accepts a valid health payload", () => {
    const payload = { status: "ok", service: "api", time: new Date().toISOString() };
    expect(healthResponseSchema.parse(payload)).toEqual(payload);
  });

  it("rejects a non-ok status", () => {
    const result = healthResponseSchema.safeParse({
      status: "down",
      service: "api",
      time: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe("apiErrorSchema", () => {
  it("accepts a known error code", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "NOT_FOUND", message: "x" } }).success).toBe(
      true,
    );
  });

  it("rejects an unknown error code", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "TEAPOT", message: "x" } }).success).toBe(
      false,
    );
  });
});
