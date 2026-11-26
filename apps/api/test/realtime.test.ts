import type { AddressInfo } from "node:net";
import { outbox } from "@flolist/db";
import { serverMessageSchema, uuidv7, type ServerMessage } from "@flolist/shared";
import { serve, type ServerType } from "@hono/node-server";
import { isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { silentLogger } from "../src/lib/logger.ts";
import { Hub } from "../src/realtime/hub.ts";
import { createOutboxDrainer, type OutboxDrainer } from "../src/realtime/outbox.ts";
import { mountRealtime } from "../src/realtime/ws.ts";
import type { ResolveUser } from "../src/types.ts";
import { createTestDb, type TestDb } from "./db.ts";
import { as, makePersonalWorkspace, makeUser, send, testApp } from "./factories.ts";

const APP_URL = "http://app.test";

let t: TestDb;
let server: ServerType;
let base: string;
let drainer: OutboxDrainer;
let closeRealtime: () => void;
let app: ReturnType<typeof testApp>;

const resolveUser: ResolveUser = (req) => {
  const id = req.headers.get("x-test-user");
  return Promise.resolve(id ? { id } : null);
};

beforeAll(async () => {
  t = await createTestDb();
  const hub = new Hub();
  drainer = createOutboxDrainer(t.db, hub, silentLogger);
  app = testApp(t.db, { afterMutation: drainer.kick });
  const realtime = mountRealtime(app, {
    db: t.db,
    hub,
    resolveUser,
    logger: silentLogger,
    appUrl: APP_URL,
  });
  closeRealtime = realtime.close;
  server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => {
      resolve(s);
    });
  });
  realtime.injectWebSocket(server);
  base = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}/ws`;
});

afterAll(async () => {
  closeRealtime();
  await new Promise((resolve) => server.close(resolve));
  await t.drop();
});

/** A connected client that records every message it gets. */
interface Client {
  ws: WebSocket;
  messages: ServerMessage[];
  next: (match: (m: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
  send: (msg: unknown) => void;
}

function connect(userId: string, headers: Record<string, string> = {}): Promise<Client> {
  const ws = new WebSocket(base, {
    headers: { "x-test-user": userId, origin: APP_URL, ...headers },
  });
  const messages: ServerMessage[] = [];
  const waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  ws.on("message", (raw: Buffer) => {
    const msg = serverMessageSchema.parse(JSON.parse(raw.toString("utf8")));
    messages.push(msg);
    for (const w of waiters.splice(0)) {
      if (w.match(msg)) w.resolve(msg);
      else waiters.push(w);
    }
  });
  const client: Client = {
    ws,
    messages,
    send: (msg) => {
      ws.send(JSON.stringify(msg));
    },
    next: (match, timeoutMs = 3000) => {
      const seen = messages.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`no matching message; got ${JSON.stringify(messages)}`));
        }, timeoutMs);
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => {
      resolve(client);
    });
    ws.once("error", reject);
  });
}

function upgradeStatus(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base, { headers });
    ws.once("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
    });
    ws.once("open", () => {
      ws.close();
      reject(new Error("upgrade unexpectedly succeeded"));
    });
    ws.once("error", () => {
      // "unexpected-response" already resolved
    });
  });
}

const isReady = (m: ServerMessage) => m.type === "ready";

describe("/ws", () => {
  it("refuses anonymous sockets and other origins", async () => {
    const me = await makeUser(t.db);
    expect(await upgradeStatus({ origin: APP_URL })).toBe(401);
    expect(await upgradeStatus({ origin: "https://evil.test", "x-test-user": me.id })).toBe(403);
  });

  it("joins the user's own and workspace channels", async () => {
    const me = await makeUser(t.db);
    const personal = await makePersonalWorkspace(t.db, me);
    const client = await connect(me.id);
    const ready = await client.next(isReady);
    expect(ready).toEqual({
      type: "ready",
      channels: [`user:${me.id}`, `workspace:${personal.id}`],
    });
    client.send({ type: "ping" });
    await client.next((m) => m.type === "pong");
    client.ws.close();
  });

  it("delivers a mutation's events to the user's other sockets, and to nobody else", async () => {
    const me = await makeUser(t.db);
    const other = await makeUser(t.db);
    await makePersonalWorkspace(t.db, me);
    const [mine, theirs] = await Promise.all([connect(me.id), connect(other.id)]);
    await Promise.all([mine.next(isReady), theirs.next(isReady)]);

    const id = uuidv7();
    const res = await app.request(
      "/api/v1/lists",
      as(me, send("POST", { clientMutationId: crypto.randomUUID(), id, title: "Live" })),
    );
    expect(res.status).toBe(201);

    const listEvent = await mine.next((m) => m.type === "change" && m.entity === "list");
    expect(listEvent).toMatchObject({ op: "upsert", id, data: { title: "Live" } });
    await mine.next((m) => m.type === "change" && m.entity === "sidebarEntry");

    await drainer.drain();
    const pending = await t.db.select().from(outbox).where(isNull(outbox.dispatchedAt));
    expect(pending).toEqual([]);
    expect(theirs.messages.filter((m) => m.type === "change")).toEqual([]);
    mine.ws.close();
    theirs.ws.close();
  });

  it("joins a list channel only when the user can see the list", async () => {
    const me = await makeUser(t.db);
    const other = await makeUser(t.db);
    await makePersonalWorkspace(t.db, me);
    const id = uuidv7();
    await app.request(
      "/api/v1/lists",
      as(me, send("POST", { clientMutationId: crypto.randomUUID(), id })),
    );

    const [mine, theirs] = await Promise.all([connect(me.id), connect(other.id)]);
    await Promise.all([mine.next(isReady), theirs.next(isReady)]);
    mine.send({ type: "subscribe", channel: `list:${id}` });
    theirs.send({ type: "subscribe", channel: `list:${id}` });
    expect(await mine.next((m) => m.type === "subscribed")).toEqual({
      type: "subscribed",
      channel: `list:${id}`,
    });
    expect(await theirs.next((m) => m.type === "error")).toMatchObject({
      channel: `list:${id}`,
    });
    theirs.send({ type: "subscribe", channel: "user:someone-else" });
    await theirs.next((m) => m.type === "error" && m.message === "Unknown message");
    mine.ws.close();
    theirs.ws.close();
  });
});
