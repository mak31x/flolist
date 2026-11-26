import type { ChangeEvent, ListIndexItem, Sidebar } from "@flolist/shared";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../../test-socket.ts";
import { listKey, listsKey, sidebarKey } from "../lists/api.ts";
import { applyChange, mutationKeys } from "./apply-change.ts";
import { LiveSocket } from "./socket.ts";

const L1 = "0190a000-0000-7000-8000-00000000000a";
const L2 = "0190a000-0000-7000-8000-00000000000b";
const FAV = "0190a000-0000-7000-8000-0000000000f0";
const WORK = "0190a000-0000-7000-8000-0000000000f1";
const ME = "0190a000-0000-7000-8000-000000000001";

const list = (id: string, extra: Partial<ListIndexItem> = {}): ListIndexItem => ({
  id,
  workspaceId: ME,
  rootListId: id,
  parentListId: null,
  parentBlockId: null,
  title: "List",
  cover: null,
  emoji: null,
  createdBy: ME,
  version: 1,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
  lastOpenedAt: null,
  ...extra,
});

const sidebar = (): Sidebar => ({
  sections: [
    { id: FAV, title: "Favorites", position: "a0", collapsed: false, isDefault: true, version: 1 },
  ],
  entries: [{ listId: L1, sectionId: FAV, position: "a0", version: 1 }],
});

/** The shared fields of a list, as change events carry them. */
function shared(item: ListIndexItem): Omit<ListIndexItem, "lastOpenedAt"> {
  const data: Partial<ListIndexItem> = { ...item };
  delete data.lastOpenedAt;
  return data as Omit<ListIndexItem, "lastOpenedAt">;
}

const listEvent = (version: number, title: string, id = L1): ChangeEvent => {
  const data = shared(list(id, { version, title }));
  return {
    type: "change",
    op: "upsert",
    entity: "list",
    id,
    version,
    clientMutationId: null,
    data,
  };
};

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(listsKey, [list(L1, { lastOpenedAt: "2026-11-26T11:00:00.000Z" })]);
  qc.setQueryData(sidebarKey, sidebar());
});

describe("applyChange", () => {
  it("applies newer list versions, keeps lastOpenedAt, and ignores stale ones", () => {
    applyChange(qc, listEvent(2, "Renamed"));
    const items = qc.getQueryData<ListIndexItem[]>(listsKey);
    expect(items?.[0]).toMatchObject({ title: "Renamed", version: 2 });
    expect(items?.[0]?.lastOpenedAt).toBe("2026-11-26T11:00:00.000Z");
    applyChange(qc, listEvent(2, "Echo"));
    applyChange(qc, listEvent(1, "Old"));
    expect(qc.getQueryData<ListIndexItem[]>(listsKey)?.[0]?.title).toBe("Renamed");
  });

  it("adds lists it hasn't seen, newest first", () => {
    const data = shared(list(L2, { title: "New", createdAt: "2026-11-26T12:00:00.000Z" }));
    applyChange(qc, { ...listEvent(1, "New", L2), data } as ChangeEvent);
    expect(qc.getQueryData<ListIndexItem[]>(listsKey)?.map((l) => l.id)).toEqual([L2, L1]);
  });

  it("removes a deleted list everywhere", () => {
    qc.setQueryData(listKey(L1), list(L1));
    applyChange(qc, {
      type: "change",
      op: "delete",
      entity: "list",
      id: L1,
      version: 2,
      clientMutationId: null,
    });
    expect(qc.getQueryData(listsKey)).toEqual([]);
    expect(qc.getQueryData(listKey(L1))).toBeNull();
    expect(qc.getQueryData<Sidebar>(sidebarKey)?.entries).toEqual([]);
  });

  it("moves entries and drops a deleted section's entries", () => {
    applyChange(qc, {
      type: "change",
      op: "upsert",
      entity: "section",
      id: WORK,
      version: 1,
      clientMutationId: null,
      data: {
        id: WORK,
        title: "Work",
        position: "Zz",
        collapsed: false,
        isDefault: false,
        version: 1,
      },
    });
    applyChange(qc, {
      type: "change",
      op: "upsert",
      entity: "sidebarEntry",
      id: L1,
      version: 2,
      clientMutationId: null,
      data: { listId: L1, sectionId: WORK, position: "a0", version: 2 },
    });
    let state = qc.getQueryData<Sidebar>(sidebarKey);
    expect(state?.sections.map((s) => s.title)).toEqual(["Work", "Favorites"]);
    expect(state?.entries[0]?.sectionId).toBe(WORK);

    applyChange(qc, {
      type: "change",
      op: "delete",
      entity: "section",
      id: WORK,
      version: 2,
      clientMutationId: null,
    });
    state = qc.getQueryData<Sidebar>(sidebarKey);
    expect(state?.sections.map((s) => s.id)).toEqual([FAV]);
    expect(state?.entries).toEqual([]);
  });

  it("waits while a local mutation on the same data is in flight", async () => {
    const pending = new Promise(() => undefined);
    void qc
      .getMutationCache()
      .build(qc, { mutationKey: mutationKeys.list(L1), mutationFn: () => pending })
      .execute(undefined);
    await vi.waitFor(() => {
      expect(qc.isMutating({ mutationKey: mutationKeys.list(L1) })).toBe(1);
    });
    applyChange(qc, listEvent(5, "Remote"));
    expect(qc.getQueryData<ListIndexItem[]>(listsKey)?.[0]?.title).toBe("List");
  });
});

describe("LiveSocket", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    const onMessage = vi.fn();
    const onReady = vi.fn();
    const socket = new LiveSocket({
      url: () => "ws://test/ws",
      open: (url) => new FakeSocket(url),
      onMessage,
      onReady,
      delayMs: () => 1000,
    });
    return { socket, onMessage, onReady };
  }

  it("forwards events and joins list channels once per list", () => {
    const { socket, onMessage, onReady } = make();
    socket.start();
    const ws = FakeSocket.last();
    if (!ws) throw new Error("no socket");
    const releaseA = socket.joinList(L1);
    const releaseB = socket.joinList(L1);
    ws.acceptAndReady([`user:${ME}`]);
    expect(onReady).toHaveBeenCalledWith(false);
    expect(ws.sent).toEqual([{ type: "subscribe", channel: `list:${L1}` }]);

    ws.receive(listEvent(2, "x"));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ entity: "list" }));
    ws.receive({ type: "nonsense" });
    expect(onMessage).toHaveBeenCalledTimes(1);

    releaseA();
    expect(ws.sent).toHaveLength(1);
    releaseB();
    expect(ws.sent.at(-1)).toEqual({ type: "unsubscribe", channel: `list:${L1}` });
    socket.stop();
    expect(ws.closed).toBe(true);
  });

  it("reconnects after a drop, rejoins its lists and reports the reconnect", () => {
    vi.useFakeTimers();
    const { socket, onReady } = make();
    socket.start();
    socket.joinList(L1);
    FakeSocket.last()?.acceptAndReady();
    FakeSocket.last()?.drop();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    const second = FakeSocket.last();
    expect(FakeSocket.instances).toHaveLength(2);
    second?.acceptAndReady();
    expect(onReady).toHaveBeenLastCalledWith(true);
    expect(second?.sent).toEqual([{ type: "subscribe", channel: `list:${L1}` }]);
    socket.stop();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
