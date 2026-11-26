/**
 * In-process pub/sub for live sync (architecture.md → Live sync: single node). Each connection
 * joins channels; `publish` sends an event once per connection even when it matches several
 * of its channels. Postgres LISTEN/NOTIFY replaces this only if the API ever scales out.
 */

export interface HubConnection {
  send: (data: string) => void;
}

interface ConnectionState {
  userId: string;
  channels: Set<string>;
}

/** Keeps a single client from holding an unbounded number of channels. */
export const MAX_CHANNELS_PER_CONNECTION = 500;

export class Hub {
  private readonly byChannel = new Map<string, Set<HubConnection>>();
  private readonly connections = new Map<HubConnection, ConnectionState>();

  add(conn: HubConnection, userId: string): void {
    this.connections.set(conn, { userId, channels: new Set() });
  }

  remove(conn: HubConnection): void {
    const state = this.connections.get(conn);
    if (!state) return;
    for (const ch of state.channels) this.leave(conn, ch);
    this.connections.delete(conn);
  }

  /** Returns false when the connection is unknown or at its channel limit. */
  subscribe(conn: HubConnection, channel: string): boolean {
    const state = this.connections.get(conn);
    if (!state) return false;
    if (state.channels.has(channel)) return true;
    if (state.channels.size >= MAX_CHANNELS_PER_CONNECTION) return false;
    state.channels.add(channel);
    let set = this.byChannel.get(channel);
    if (!set) {
      set = new Set();
      this.byChannel.set(channel, set);
    }
    set.add(conn);
    return true;
  }

  unsubscribe(conn: HubConnection, channel: string): void {
    const state = this.connections.get(conn);
    if (!state?.channels.delete(channel)) return;
    this.leave(conn, channel);
  }

  publish(channels: readonly string[], event: unknown): number {
    const targets = new Set<HubConnection>();
    for (const ch of channels) {
      for (const conn of this.byChannel.get(ch) ?? []) targets.add(conn);
    }
    if (targets.size === 0) return 0;
    const data = JSON.stringify(event);
    for (const conn of targets) {
      try {
        conn.send(data);
      } catch {
        // A socket that died mid-send is removed by its close handler.
      }
    }
    return targets.size;
  }

  channelsOf(conn: HubConnection): string[] {
    return [...(this.connections.get(conn)?.channels ?? [])];
  }

  get size(): number {
    return this.connections.size;
  }

  private leave(conn: HubConnection, channel: string): void {
    const set = this.byChannel.get(channel);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.byChannel.delete(channel);
  }
}
