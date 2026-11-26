import { textInline, type Block, type BlockBatchResult } from "@flolist/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../lib/api.ts";
import { blocksKey } from "./api.ts";
import { EditorCommands } from "./commands.ts";
import { BlockStore } from "./store.ts";

const listId = "0190a5d2-7c1e-7000-8000-00000000aaaa";
const id = (n: number) => `0190a5d2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const text = (s: string) => ({ inline: textInline(s) });

const block = (n: number, over: Partial<Block> = {}): Block => ({
  id: id(n),
  containerType: "list",
  containerId: listId,
  rootListId: listId,
  position: `a${String(n)}`,
  type: "paragraph",
  indent: 0,
  content: text(`block ${String(n)}`),
  fileId: null,
  sublistId: null,
  taskId: null,
  task: null,
  createdBy: null,
  version: 1,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
  ...over,
});

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(blocksKey(listId), [block(1), block(2)]);
  const send = vi.fn((): Promise<BlockBatchResult> => Promise.resolve({ blocks: [], deleted: [] }));
  const store = new BlockStore({
    qc,
    listId,
    rootListId: listId,
    send,
    retryDelaysMs: [],
    sleep: () => Promise.resolve(),
  });
  let now = 1_000;
  const commands = new EditorCommands(store, () => now);
  const tick = (ms: number) => {
    now += ms;
  };
  const view = () =>
    (qc.getQueryData<Block[]>(blocksKey(listId)) ?? []).map((b) => [
      b.id.slice(-1),
      b.type,
      "inline" in b.content
        ? b.content.inline.map((n) => (n.type === "text" ? n.text : "⏎")).join("")
        : "—",
    ]);
  return { store, commands, send, tick, view };
}

describe("EditorCommands", () => {
  it("undoes and redoes a structural command", () => {
    const { commands, view } = setup();
    commands.run([
      { op: "upsert", id: id(1), fields: { type: "heading1" } },
      { op: "upsert", id: id(3), fields: { type: "bullet", position: "a3", content: text("new") } },
    ]);
    const after = view();
    expect(after).toEqual([
      ["1", "heading1", "block 1"],
      ["2", "paragraph", "block 2"],
      ["3", "bullet", "new"],
    ]);
    expect(commands.undo()).toBe(true);
    expect(view()).toEqual([
      ["1", "paragraph", "block 1"],
      ["2", "paragraph", "block 2"],
    ]);
    expect(commands.redo()).toBe(true);
    expect(view()).toEqual(after);
    expect(commands.redo()).toBe(false);
  });

  it("undoes a delete by restoring the block where it was", () => {
    const { commands, view } = setup();
    commands.run([{ op: "delete", id: id(1) }]);
    expect(view().map((r) => r[0])).toEqual(["2"]);
    commands.undo();
    expect(view()).toEqual([
      ["1", "paragraph", "block 1"],
      ["2", "paragraph", "block 2"],
    ]);
  });

  it("groups a typing burst in one block into one step, split by pauses and other blocks", () => {
    const { commands, tick, view } = setup();
    const type = (n: number, s: string) => {
      commands.run([{ op: "upsert", id: id(n), fields: { content: text(s) } }], {
        delay: "typing",
        coalesce: id(n),
      });
      tick(100);
    };
    type(1, "a");
    type(1, "ab");
    type(1, "abc");
    tick(2_000);
    type(1, "abcd");
    type(2, "x");
    commands.undo();
    expect(view()[1]).toEqual(["2", "paragraph", "block 2"]);
    commands.undo();
    expect(view()[0]).toEqual(["1", "paragraph", "abc"]);
    commands.undo();
    expect(view()[0]).toEqual(["1", "paragraph", "block 1"]);
    commands.redo();
    expect(view()[0]).toEqual(["1", "paragraph", "abc"]);
  });

  it("a new command clears the redo stack", () => {
    const { commands } = setup();
    commands.run([{ op: "upsert", id: id(1), fields: { type: "quote" } }]);
    commands.undo();
    expect(commands.canRedo).toBe(true);
    commands.run([{ op: "upsert", id: id(2), fields: { type: "quote" } }]);
    expect(commands.canRedo).toBe(false);
  });

  it("records nothing for a no-op and forgets everything after a rollback", async () => {
    const { store, commands, send } = setup();
    commands.run([{ op: "upsert", id: id(1), fields: { type: "paragraph" } }]);
    expect(commands.canUndo).toBe(false);
    send.mockRejectedValueOnce(new ApiRequestError(400, "VALIDATION", "nope"));
    commands.run([{ op: "upsert", id: id(1), fields: { type: "quote" } }]);
    await store.flush();
    expect(commands.canUndo).toBe(false);
    expect(commands.canRedo).toBe(false);
  });
});
