import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for critical flows (D-014). They run the real API and web dev servers
 * against the dev Postgres and Mailpit (infra/docker-compose.dev.yml locally, service
 * containers in CI), on the default ports from .env.example (D-019).
 */
const WEB_URL = `http://localhost:${process.env.WEB_PORT ?? "5174"}`;
const API_URL = `http://127.0.0.1:${process.env.API_PORT ?? "3000"}`;
const CI = process.env.CI !== undefined;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  // Chromium only for now [assumption]; WebKit matters once the Tauri/Capacitor shells exist.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @flolist/api exec tsx --env-file-if-exists=../../.env src/index.ts",
      url: `${API_URL}/api/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
      // Every test signs up a fresh account; the default auth limit (10/min/IP) would refuse
      // sign-ups once the suite (with retries) outgrows it.
      env: { APP_URL: WEB_URL, LOG_LEVEL: "warn", AUTH_RATE_LIMIT_MAX: "1000" },
    },
    {
      command: "pnpm --filter @flolist/web dev",
      url: WEB_URL,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
