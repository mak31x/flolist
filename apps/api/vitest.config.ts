import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Container start + migrations can take a while on a cold Docker cache.
    hookTimeout: 120_000,
  },
});
