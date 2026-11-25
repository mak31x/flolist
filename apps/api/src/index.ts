import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const server = serve(
  { fetch: createApp().fetch, hostname: env.API_HOST, port: env.API_PORT },
  (info) => {
    console.log(`[api] listening on http://${info.address}:${info.port}`);
  },
);

function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
