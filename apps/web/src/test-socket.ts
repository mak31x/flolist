import type { SocketLike } from "./features/sync/socket.ts";

/** In-memory WebSocket for tests: records what was sent; the test drives open/messages/close. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  /** Simulates the server accepting the socket and joining its channels. */
  acceptAndReady(channels: string[] = []): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
    this.receive({ type: "ready", channels });
  }

  receive(msg: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(msg) }));
  }

  /** Simulates the connection dropping. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static last(): FakeSocket | undefined {
    return FakeSocket.instances.at(-1);
  }
}
