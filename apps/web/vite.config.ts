import { themeBootScript } from "@flolist/ui/theme";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

// One .env at the repo root serves every app (see .env.example).
const envDir = fileURLToPath(new URL("../..", import.meta.url));

/** Applies the cached theme before first paint (no flash of the wrong theme). */
function themeBoot(): Plugin {
  return {
    name: "flolist-theme-boot",
    transformIndexHtml: () => [
      { tag: "script", children: themeBootScript, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  const apiTarget = `http://127.0.0.1:${env.API_PORT ?? "3000"}`;

  return {
    envDir,
    plugins: [themeBoot(), tailwindcss(), react()],
    server: {
      port: Number(env.WEB_PORT ?? 5174),
      strictPort: true,
      // Same-origin in dev, like Caddy in prod: /api and /ws go to the API.
      proxy: {
        "/api": { target: apiTarget },
        "/ws": { target: apiTarget, ws: true },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      css: false,
    },
  };
});
