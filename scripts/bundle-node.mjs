// Bundles a Node app (api, worker) into self-contained ESM files for the production image.
// Internal @flolist/* packages are TypeScript source (D-020) and Node won't strip types inside
// node_modules, so everything, npm dependencies included, is bundled and the image needs no
// node_modules at all.
//
// Usage (from an app folder): node ../../scripts/bundle-node.mjs <name>=<entry.ts> [...]
import { build } from "esbuild";

const entryPoints = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, entry] = arg.split("=");
    if (!name || !entry) throw new Error(`Expected <name>=<entry>, got "${arg}"`);
    return [name, entry];
  }),
);

await build({
  entryPoints,
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "esm",
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "info",
  // Bundled CommonJS deps (pg, pino) still call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __flolistCreateRequire } from 'node:module'; const require = __flolistCreateRequire(import.meta.url);",
  },
  // Optional native/dev-only modules that are never loaded in production.
  external: ["pg-native", "pino-pretty"],
});
