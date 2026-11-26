import { serverMessageSchema, type ServerMessage } from "@flolist/shared";

/** The subset of the browser WebSocket the client uses (so tests can pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export interface LiveSocketOptions {
  url: () => string;
  open: (url: string) => SocketLike;
  onMessage: (msg: ServerMessage) => void;
  /** After the server joined the socket's channels; `reconnected` is false the first time. */
  onReady: (reconnected: boolean) => void;
  /** Backoff before reconnect attempt `n` (from 0). */
  delayMs?: (attempt: number) => number;
}

const OPEN = 1;

/** Exponential backoff with jitter: about 1 s, 2 s, 4 s … capped at 30 s. */
export const defaultDelay = (attempt: number) =>
  Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

/**
 * One live-sync socket per client (architecture.md → Live sync). Reconnects with backoff,
 * rejoins the list channels it was asked for, and reports when it's ready again so the app
 * can refetch what it may have missed.
 */
export class LiveSocket {
  private socket: SocketLike | null = null;
  private readonly lists = new Map<string, number>();
  private attempt = 0;
  private everReady = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly options: LiveSocketOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close(1000, "client stopped");
    }
  }

  /** Reconnect now if the socket is down (e.g. the device came back online). */
  wake(): void {
    if (this.stopped || this.socket) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.connect();
  }

  /** Joins `list:<id>` while at least one caller holds it. Returns the release function. */
  joinList(listId: string): () => void {
    const count = this.lists.get(listId) ?? 0;
    this.lists.set(listId, count + 1);
    if (count === 0) this.send({ type: "subscribe", channel: `list:${listId}` });
    return () => {
      const n = (this.lists.get(listId) ?? 1) - 1;
      if (n > 0) {
        this.lists.set(listId, n);
        return;
      }
      this.lists.delete(listId);
      this.send({ type: "unsubscribe", channel: `list:${listId}` });
    };
  }

  private send(msg: unknown): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(msg));
  }

  private connect(): void {
    let s: SocketLike;
    try {
      s = this.options.open(this.options.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = s;
    s.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let parsed: ServerMessage;
      try {
        parsed = serverMessageSchema.parse(JSON.parse(ev.data));
      } catch {
        return;
      }
      if (parsed.type === "ready") {
        this.attempt = 0;
        for (const id of this.lists.keys()) this.send({ type: "subscribe", channel: `list:${id}` });
        this.options.onReady(this.everReady);
        this.everReady = true;
        return;
      }
      this.options.onMessage(parsed);
    };
    s.onclose = () => {
      if (this.socket === s) this.socket = null;
      this.scheduleReconnect();
    };
    s.onerror = () => {
      // onclose follows and schedules the reconnect.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const delay = (this.options.delayMs ?? defaultDelay)(this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped && !this.socket) this.connect();
    }, delay);
  }
}
