import { member, workspaces, type Db } from "@flolist/db";
import { channel, clientMessageSchema, type ServerMessage } from "@flolist/shared";
import { createNodeWebSocket } from "@hono/node-ws";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Logger } from "pino";
import { authorize } from "../authz/authorize.ts";
import { ApiException } from "../lib/errors.ts";
import type { AppEnv, AuthUser, ResolveUser } from "../types.ts";
import type { Hub, HubConnection } from "./hub.ts";

export interface RealtimeOptions {
  db: Db;
  hub: Hub;
  resolveUser: ResolveUser;
  logger: Logger;
  /** APP_URL: browsers must open the socket from this origin (no cross-site socket hijacking). */
  appUrl?: string | undefined;
  /** Ping interval; a socket that misses one pong is dropped. */
  heartbeatMs?: number;
}

/** Client messages are tiny; anything bigger is a bug or abuse. */
const MAX_MESSAGE_BYTES = 4 * 1024;

/** Channels every socket joins on open: its user plus each workspace it belongs to. */
async function initialChannels(db: Db, user: AuthUser): Promise<string[]> {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .leftJoin(
      member,
      and(eq(member.organizationId, workspaces.organizationId), eq(member.userId, user.id)),
    )
    .where(
      and(
        isNull(workspaces.deletedAt),
        or(
          and(eq(workspaces.kind, "personal"), eq(workspaces.ownerId, user.id)),
          and(eq(workspaces.kind, "team"), eq(member.userId, user.id)),
        ),
      ),
    );
  return [channel.user(user.id), ...rows.map((r) => channel.workspace(r.id))];
}

/**
 * Mounts `/ws` (architecture.md → Live sync): one socket per client, authenticated like the
 * REST API (session cookie, or bearer token for native shells). Clients join `list:<rootId>`
 * channels on demand; each join is checked with `authorize(list.view)`. Returns the function
 * that attaches the upgrade handler to the Node server.
 */
export function mountRealtime(app: Hono<AppEnv>, options: RealtimeOptions) {
  const { db, hub, logger } = options;
  const nodeWs = createNodeWebSocket({ app });
  const { upgradeWebSocket, wss } = nodeWs;
  wss.options.maxPayload = MAX_MESSAGE_BYTES;
  const appOrigin = options.appUrl ? new URL(options.appUrl).origin : null;

  const alive = new WeakSet<object>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref();

  app.get(
    "/ws",
    async (c, next) => {
      const origin = c.req.header("origin");
      if (appOrigin && origin && origin !== appOrigin) return c.text("Forbidden", 403);
      const user = await options.resolveUser(c.req.raw);
      if (!user) return c.text("Unauthorized", 401);
      c.set("user", user);
      await next();
    },
    upgradeWebSocket((c: Context<AppEnv>) => {
      const user = c.get("user");
      if (!user) throw new Error("unreachable: /ws without a user");
      let conn: HubConnection | null = null;
      const send = (msg: ServerMessage) => conn?.send(JSON.stringify(msg));

      return {
        onOpen: (_evt, ws) => {
          const raw = ws.raw;
          if (raw) {
            alive.add(raw);
            raw.on("pong", () => alive.add(raw));
          }
          const current: HubConnection = {
            send: (data) => {
              ws.send(data);
            },
          };
          conn = current;
          hub.add(current, user.id);
          void initialChannels(db, user)
            .then((channels) => {
              for (const ch of channels) hub.subscribe(current, ch);
              send({ type: "ready", channels });
            })
            .catch((err: unknown) => {
              logger.error({ err }, "ws: joining initial channels failed");
              ws.close(1011, "internal error");
            });
        },

        onMessage: (evt, ws) => {
          const current = conn;
          if (!current || typeof evt.data !== "string") return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(evt.data);
          } catch {
            send({ type: "error", message: "Messages must be JSON" });
            return;
          }
          const msg = clientMessageSchema.safeParse(parsed);
          if (!msg.success) {
            send({ type: "error", message: "Unknown message" });
            return;
          }
          const m = msg.data;
          if (m.type === "ping") {
            send({ type: "pong" });
            return;
          }
          if (m.type === "unsubscribe") {
            hub.unsubscribe(current, m.channel);
            return;
          }
          const listId = m.channel.slice("list:".length).toLowerCase();
          authorize(db, user, "list.view", { type: "list", id: listId })
            .then(({ root }) => {
              const ch = channel.list(root.id);
              if (!hub.subscribe(current, ch)) {
                send({ type: "error", message: "Too many channels", channel: m.channel });
                return;
              }
              send({ type: "subscribed", channel: ch });
            })
            .catch((err: unknown) => {
              if (err instanceof ApiException) {
                send({ type: "error", message: err.message, channel: m.channel });
                return;
              }
              logger.error({ err }, "ws: subscribe failed");
              ws.close(1011, "internal error");
            });
        },

        onClose: () => {
          if (conn) hub.remove(conn);
          conn = null;
        },
      };
    }),
  );

  return {
    injectWebSocket: (server: Parameters<typeof nodeWs.injectWebSocket>[0]) => {
      nodeWs.injectWebSocket(server);
    },
    close: () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, "server shutting down");
    },
  };
}
