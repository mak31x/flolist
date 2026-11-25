import { createMiddleware } from "hono/factory";
import type { Logger } from "pino";
import type { AppEnv } from "../types.ts";

/** Gives each request a child logger tagged with its request id and logs one line per response. */
export function requestLog(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const start = performance.now();
    const log = logger.child({ reqId: c.get("requestId") });
    c.set("log", log);
    await next();
    const status = c.res.status;
    const entry = {
      method: c.req.method,
      path: c.req.path,
      status,
      ms: Math.round(performance.now() - start),
      userId: c.get("user")?.id,
    };
    if (status >= 500) log.error(entry, "request failed");
    else if (status >= 400) log.warn(entry, "request rejected");
    else log.info(entry, "request");
  });
}
