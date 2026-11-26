import { themeBootScript } from "@flolist/ui/theme";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

/**
 * Serves the emoji picker's data (frimousse reads Emojibase JSON) from our own origin at
 * /emojibase/en/*.json, so the picker makes no third-party request and works in the native
 * wrappers without network access to a CDN.
 */
function emojibase(): Plugin {
  const require = createRequire(import.meta.url);
  const files = ["data.json", "messages.json"];
  const read = (file: string) => readFileSync(require.resolve(`emojibase-data/en/${file}`));
  return {
    name: "flolist-emojibase",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.find((f) => req.url === `/emojibase/en/${f}`);
        if (!file) {
          next();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(read(file));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: "asset", fileName: `emojibase/en/${file}`, source: read(file) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  const apiTarget = `http://127.0.0.1:${env.API_PORT ?? "3000"}`;

  return {
    envDir,
    plugins: [themeBoot(), emojibase(), tailwindcss(), react()],
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
