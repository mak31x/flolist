import {
  textInline,
  type Block,
  type BlockBatch,
  type BlockBatchResult,
  type BlockOp,
} from "@flolist/shared";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../lib/api.ts";
import { blocksKey } from "./api.ts";
import { applyBlockChange, BlockStore, registerBlockStore } from "./store.ts";

const listId = "0190a5d2-7c1e-7000-8000-00000000aaaa";
const id = (n: number) => `0190a5d2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const text = (s: string) => ({ inline: textInline(s) });

function block(n: number, over: Partial<Block> = {}): Block {
  return {
    id: id(n),
    containerType: "list",
    containerId: listId,
    rootListId: listId,
    position: `a${String(n)}`,
    type: "paragraph",
    indent: 0,
    content: text(`block ${String(n)}`),
    createdBy: null,
    version: 1,
    createdAt: "2026-11-26T10:00:00.000Z",
    updatedAt: "2026-11-26T10:00:00.000Z",
    ...over,
  };
}

/** A fake server: applies batches to its own rows and answers like the API. */
function fakeServer(initial: Block[]) {
  const rows = new Map(initial.map((b) => [b.id, { ...b }]));
  const calls: BlockBatch[] = [];
  const send = vi.fn((_listId: string, input: BlockBatch): Promise<BlockBatchResult> => {
    calls.push(input);
    const blocks: Block[] = [];
    const deleted: string[] = [];
    for (const op of input.ops) {
      if (op.op === "delete") {
        if (rows.delete(op.id)) deleted.push(op.id);
        continue;
      }
      const upsert = op as Extract<BlockOp, { op: "upsert" }>;
      const opId = upsert.id;
      const fields: Partial<Block> = {};
      for (const key of ["type", "position", "indent", "content"] as const) {
        if (upsert[key] !== undefined) Object.assign(fields, { [key]: upsert[key] });
      }
      const prev = rows.get(opId);
      const next = prev
        ? { ...prev, ...fields, version: prev.version + 1 }
        : { ...block(0), ...fields, id: opId, version: 1 };
      rows.set(opId, next);
      blocks.push(next);
    }
    return Promise.resolve({ blocks, deleted });
  });
  return { rows, calls, send };
}

function setup(
  initial: Block[] = [block(1), block(2)],
  over: Partial<ConstructorParameters<typeof BlockStore>[0]> = {},
) {
  const qc = new QueryClient();
  qc.setQueryData(blocksKey(listId), initial);
  const server = fakeServer(initial);
  const onError = vi.fn();
  const store = new BlockStore({
    qc,
    listId,
    rootListId: listId,
    send: server.send,
    onError,
    retryDelaysMs: [1, 1],
    sleep: () => Promise.resolve(),
    ...over,
  });
  const cache = () => qc.getQueryData<Block[]>(blocksKey(listId)) ?? [];
  return { qc, store, server, onError, cache };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BlockStore.apply", () => {
  it("creates optimistically, sends the whole shape and adopts the server's version", async () => {
    const { store, server, cache } = setup();
    store.apply([
      {
        op: "upsert",
        id: id(3),
        fields: { type: "heading1", position: "a1V", content: text("New") },
      },
    ]);
    expect(cache().map((b) => b.id)).toEqual([id(1), id(3), id(2)]);
    expect(cache()[1]).toMatchObject({ type: "heading1", version: 0 });
    await store.flush();
    expect(server.calls[0]?.ops).toEqual([
      {
        op: "upsert",
        id: id(3),
        type: "heading1",
        position: "a1V",
        indent: 0,
        content: text("New"),
      },
    ]);
    expect(cache()[1]?.version).toBe(1);
    expect(store.busy).toBe(false);
  });

  it("merges a typing burst into one partial upsert", async () => {
    const { store, server } = setup();
    for (const s of ["b", "bl", "blo"])
      store.apply([{ op: "upsert", id: id(1), fields: { content: text(s) } }], "typing");
    await store.flush();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]?.ops).toEqual([{ op: "upsert", id: id(1), content: text("blo") }]);
  });

  it("sends after the typing pause on its own", async () => {
    vi.useFakeTimers();
    const { store, server } = setup(undefined, { typingDelayMs: 500 });
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("x") } }], "typing");
    await vi.advanceTimersByTimeAsync(400);
    expect(server.send).not.toHaveBeenCalled();
    // A structural command pulls the flush forward.
    store.apply([{ op: "upsert", id: id(2), fields: { type: "quote" } }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.calls[0]?.ops).toHaveLength(2);
  });

  it("sends the resolved content when a type change follows queued typing", async () => {
    const { store, server, onError } = setup();
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("--") } }], "typing");
    store.apply([{ op: "upsert", id: id(1), fields: { type: "divider" } }]);
    await store.flush();
    expect(server.calls[0]?.ops).toEqual([
      { op: "upsert", id: id(1), content: { color: "gray" }, type: "divider", indent: 0 },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns inverse ops that restore exactly what changed", () => {
    const { store } = setup([block(1, { type: "bullet", indent: 2 })]);
    const inverse = store.apply([{ op: "upsert", id: id(1), fields: { type: "divider" } }]);
    expect(inverse).toEqual([
      { op: "upsert", id: id(1), fields: { type: "bullet", indent: 2, content: text("block 1") } },
    ]);
    expect(store.apply([{ op: "upsert", id: id(1), fields: { type: "divider" } }])).toEqual([]);
    const delInverse = store.apply([{ op: "delete", id: id(1) }]);
    expect(delInverse).toEqual([
      {
        op: "upsert",
        id: id(1),
        fields: { type: "divider", position: "a1", indent: 0, content: { color: "gray" } },
      },
    ]);
  });

  it("orders inverses for several ops so undo replays them backwards", () => {
    const { store } = setup();
    const inverse = store.apply([
      { op: "upsert", id: id(1), fields: { content: text("one") } },
      { op: "upsert", id: id(9), fields: { type: "paragraph", position: "a1V" } },
    ]);
    expect(inverse.map((o) => [o.op, o.id])).toEqual([
      ["delete", id(9)],
      ["upsert", id(1)],
    ]);
  });

  it("throws on an invalid op and leaves everything as it was", () => {
    const { store, cache } = setup();
    const before = cache();
    expect(() =>
      store.apply([
        { op: "upsert", id: id(1), fields: { content: text("changed") } },
        { op: "upsert", id: id(9), fields: { content: text("no type") } },
      ]),
    ).toThrow();
    expect(cache()).toBe(before);
    expect(store.busy).toBe(false);
  });

  it("collapses create + delete and delete + restore", async () => {
    const { store, server } = setup();
    store.apply([{ op: "upsert", id: id(5), fields: { type: "paragraph", position: "a5" } }]);
    store.apply([{ op: "delete", id: id(5) }]);
    const inverse = store.apply([{ op: "delete", id: id(1) }]);
    store.apply(inverse);
    await store.flush();
    expect(server.calls[0]?.ops).toEqual([
      { op: "delete", id: id(5) },
      {
        op: "upsert",
        id: id(1),
        type: "paragraph",
        position: "a1",
        indent: 0,
        content: text("block 1"),
      },
    ]);
  });

  it("queues changes made while a batch is in flight for the next one", async () => {
    const { store, server } = setup();
    let release: () => void = () => undefined;
    server.send.mockImplementationOnce(
      (_l, input) =>
        new Promise((resolve) => {
          release = () => {
            resolve({
              blocks: [
                {
                  ...block(1),
                  version: 2,
                  content: (input.ops[0] as { content: Block["content"] }).content,
                },
              ],
              deleted: [],
            });
          };
        }),
    );
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("first") } }]);
    const first = store.flush();
    await Promise.resolve();
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("second") } }]);
    const second = store.flush();
    release();
    await Promise.all([first, second]);
    expect(server.send).toHaveBeenCalledTimes(2);
    expect(store.get(id(1))?.content).toEqual(text("second"));
  });
});

describe("BlockStore failures", () => {
  it("retries transient errors with the same mutation id", async () => {
    const { store, server, onError } = setup();
    const ids: string[] = [];
    const real = server.send.getMockImplementation();
    server.send.mockImplementationOnce((_l, input) => {
      ids.push(input.clientMutationId);
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    server.send.mockImplementationOnce((l, input) => {
      ids.push(input.clientMutationId);
      if (!real) throw new Error("no impl");
      return real(l, input);
    });
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("retry") } }]);
    await store.flush();
    expect(ids[0]).toBe(ids[1]);
    expect(onError).not.toHaveBeenCalled();
    expect(store.get(id(1))?.version).toBe(2);
  });

  it("rolls back to the server's state on a rejected batch", async () => {
    const { qc, store, server, onError } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const rolledBack = vi.fn();
    store.onRollback(rolledBack);
    server.send.mockRejectedValueOnce(new ApiRequestError(404, "NOT_FOUND", "List not found"));
    store.apply([{ op: "delete", id: id(1) }]);
    await store.flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(rolledBack).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: blocksKey(listId) });
    expect(store.busy).toBe(false);
  });

  it("gives up after the last retry", async () => {
    const { store, server, onError } = setup();
    server.send.mockRejectedValue(new ApiRequestError(503, "UNAVAILABLE", "down"));
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("x") } }]);
    await store.flush();
    expect(server.send).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("BlockStore.receive (server rows and live events)", () => {
  it("lays queued local fields over a newer remote row", () => {
    const { store } = setup();
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("typing…") } }], "typing");
    store.receive(block(1, { version: 5, type: "heading2", content: text("theirs") }));
    expect(store.get(id(1))).toMatchObject({
      version: 5,
      type: "heading2",
      content: text("typing…"),
    });
    store.dispose();
  });

  it("ignores rows that aren't newer", () => {
    const { store } = setup([block(1, { version: 3 })]);
    store.receive(block(1, { version: 3, content: text("stale") }));
    expect(store.get(id(1))?.content).toEqual(text("block 1"));
  });

  it("keeps blocks with queued edits on a remote delete, drops the rest", () => {
    const { store, cache } = setup();
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("mine") } }], "typing");
    store.receiveDelete(id(1));
    store.receiveDelete(id(2));
    expect(cache().map((b) => b.id)).toEqual([id(1)]);
    store.dispose();
  });

  it("doesn't resurrect a block whose delete is in flight", async () => {
    const { store, server, cache } = setup();
    let release: () => void = () => undefined;
    server.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ blocks: [], deleted: [id(1)] });
          };
        }),
    );
    store.apply([{ op: "delete", id: id(1) }]);
    const done = store.flush();
    await Promise.resolve();
    store.receive(block(1, { version: 9 }));
    release();
    await done;
    expect(cache().map((b) => b.id)).toEqual([id(2)]);
  });
});

describe("BlockStore.mergeFetched", () => {
  it("keeps queued and in-flight edits, and newer local rows, over a fetched snapshot", async () => {
    const { store, server } = setup([block(1), block(2, { version: 5 }), block(3)]);
    let release: () => void = () => undefined;
    server.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ blocks: [], deleted: [] });
          };
        }),
    );
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("in flight") } }]);
    const flushing = store.flush();
    await Promise.resolve();
    store.apply([{ op: "delete", id: id(3) }], "typing");
    store.apply(
      [
        {
          op: "upsert",
          id: id(4),
          fields: { type: "quote", position: "a4", content: text("new") },
        },
      ],
      "typing",
    );
    const merged = store.mergeFetched([
      block(1, { version: 2, content: text("old server") }),
      block(2, { version: 4, content: text("older server") }),
      block(3, { version: 2 }),
    ]);
    expect(
      merged.map((b) => [
        b.id,
        "inline" in b.content
          ? b.content.inline.map((n) => (n.type === "text" ? n.text : "")).join("")
          : "",
      ]),
    ).toEqual([
      [id(1), "in flight"],
      [id(2), "block 2"],
      [id(4), "new"],
    ]);
    expect(merged[0]?.version).toBe(2);
    release();
    await flushing;
    store.dispose();
  });
});

describe("applyBlockChange", () => {
  it("routes events to the open list's store, or patches a cached list directly", () => {
    const { qc, store, cache } = setup();
    const unregister = registerBlockStore(store);
    store.apply([{ op: "upsert", id: id(1), fields: { content: text("mine") } }], "typing");
    applyBlockChange(qc, {
      type: "change",
      op: "upsert",
      entity: "block",
      id: id(1),
      version: 4,
      clientMutationId: null,
      data: block(1, { version: 4, content: text("theirs") }),
    });
    expect(store.get(id(1))?.content).toEqual(text("mine"));
    applyBlockChange(qc, {
      type: "change",
      op: "delete",
      entity: "block",
      id: id(2),
      version: 2,
      clientMutationId: null,
    });
    expect(cache().map((b) => b.id)).toEqual([id(1)]);
    store.dispose();
    unregister();

    // No store: the cache is patched with a version guard.
    applyBlockChange(qc, {
      type: "change",
      op: "upsert",
      entity: "block",
      id: id(7),
      version: 1,
      clientMutationId: null,
      data: block(7),
    });
    expect(cache().map((b) => b.id)).toEqual([id(1), id(7)]);
  });
});
