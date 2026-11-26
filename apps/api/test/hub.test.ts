import { describe, expect, it } from "vitest";
import { Hub, MAX_CHANNELS_PER_CONNECTION, type HubConnection } from "../src/realtime/hub.ts";

function conn(): HubConnection & { got: unknown[] } {
  const got: unknown[] = [];
  return { got, send: (data) => got.push(JSON.parse(data)) };
}

describe("Hub", () => {
  it("sends once per connection, only to subscribed channels", () => {
    const hub = new Hub();
    const a = conn();
    const b = conn();
    hub.add(a, "u1");
    hub.add(b, "u2");
    hub.subscribe(a, "user:u1");
    hub.subscribe(a, "list:x");
    hub.subscribe(b, "user:u2");

    expect(hub.publish(["user:u1", "list:x"], { n: 1 })).toBe(1);
    expect(a.got).toEqual([{ n: 1 }]);
    expect(b.got).toEqual([]);
    expect(hub.publish(["nobody"], { n: 2 })).toBe(0);
  });

  it("forgets channels on unsubscribe and remove", () => {
    const hub = new Hub();
    const a = conn();
    hub.add(a, "u1");
    hub.subscribe(a, "list:x");
    hub.unsubscribe(a, "list:x");
    hub.publish(["list:x"], {});
    expect(a.got).toEqual([]);
    hub.subscribe(a, "user:u1");
    hub.remove(a);
    expect(hub.size).toBe(0);
    expect(hub.subscribe(a, "user:u1")).toBe(false);
  });

  it("caps channels per connection and survives a failing socket", () => {
    const hub = new Hub();
    const a = conn();
    hub.add(a, "u1");
    for (let i = 0; i < MAX_CHANNELS_PER_CONNECTION; i += 1) {
      expect(hub.subscribe(a, `list:${String(i)}`)).toBe(true);
    }
    expect(hub.subscribe(a, "list:one-more")).toBe(false);

    const broken: HubConnection = {
      send: () => {
        throw new Error("socket gone");
      },
    };
    hub.add(broken, "u2");
    hub.subscribe(broken, "list:0");
    expect(() => hub.publish(["list:0"], {})).not.toThrow();
    expect(a.got.length).toBe(1);
  });
});
