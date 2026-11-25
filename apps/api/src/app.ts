import type { ApiError, HealthResponse } from "@flolist/shared";
import { Hono } from "hono";

export function createApp() {
  const app = new Hono();

  app.get("/api/health", (c) => {
    const body: HealthResponse = { status: "ok", service: "api", time: new Date().toISOString() };
    return c.json(body);
  });

  app.notFound((c) => {
    const body: ApiError = { error: { code: "NOT_FOUND", message: "Route not found" } };
    return c.json(body, 404);
  });

  return app;
}
