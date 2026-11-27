import { textInline, type Block } from "@flolist/shared";
import { describe, expect, it } from "vitest";
import { ancestorIn, placeNear, subtaskProgress, visibleTree, withDescendants } from "./tree.ts";

const listId = "0190a5d2-7c1e-7000-8000-00000000aaaa";
const id = (n: number) => `0190a5d2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const list = { type: "list", id: listId } as const;

function b(n: number, over: Partial<Block> = {}): Block {
  return {
    id: id(n),
    containerType: "list",
    containerId: listId,
    rootListId: listId,
    position: `a${String(n)}`,
    type: "paragraph",
    indent: 0,
    content: { inline: textInline(String(n)) },
    fileId: null,
    sublistId: null,
    taskId: null,
    task: null,
    createdBy: null,
    version: 1,
    createdAt: "2026-11-26T10:00:00.000Z",
    updatedAt: "2026-11-26T10:00:00.000Z",
    ...over,
  };
}
const task = (n: number, over: Partial<Block> = {}) =>
  b(n, {
    type: "task",
    taskId: id(100 + n),
    task: { completedAt: null, completedBy: null, due: null, priority: 0, labelIds: [] },
    ...over,
  });
const inTask = (parent: number) => ({
  containerType: "task" as const,
  containerId: id(100 + parent),
});

// Sorted by position, as the cache is.
const blocks = [
  task(1),
  task(2, { ...inTask(1), position: "a0" }),
  b(3, { ...inTask(1), position: "a1" }),
  task(4, {
    ...inTask(2),
    position: "a0",
    task: { completedAt: "x", completedBy: null, due: null, priority: 0, labelIds: [] },
  }),
  b(5),
].sort((x, y) => (x.position < y.position ? -1 : x.position > y.position ? 1 : 0));

describe("visibleTree", () => {
  it("nests subtasks under their tasks and leaves body text to the panel", () => {
    const tree = visibleTree(blocks, list);
    expect(tree.rows.map((r) => r.id)).toEqual([id(1), id(2), id(4), id(5)]);
    expect(tree.depth.get(id(4))).toBe(2);
  });

  it("hides the subtasks of collapsed tasks", () => {
    expect(visibleTree(blocks, list, new Set([id(1)])).rows.map((r) => r.id)).toEqual([
      id(1),
      id(5),
    ]);
  });

  it("shows a task body with all its blocks at the top level", () => {
    const rows = visibleTree(blocks, { type: "task", id: id(101) }).rows;
    expect(rows.map((r) => r.id)).toEqual([id(2), id(4), id(3)]);
  });
});

describe("tree helpers", () => {
  it("counts direct subtasks for the progress ring", () => {
    expect(subtaskProgress(blocks, id(101))).toEqual({ done: 0, total: 1 });
    expect(subtaskProgress(blocks, id(102))).toEqual({ done: 1, total: 1 });
  });

  it("places new blocks among same-container siblings", () => {
    const sub = blocks.find((x) => x.id === id(2)) as Block;
    const placed = placeNear(blocks, sub, "after");
    expect(placed.container).toEqual({ type: "task", id: id(101) });
    expect(placed.position && placed.position > "a0" && placed.position < "a1").toBe(true);
    expect(
      placeNear(blocks, blocks.find((x) => x.id === id(1)) as Block, "after"),
    ).not.toHaveProperty("container");
  });

  it("finds the top-level ancestor and every descendant", () => {
    const deep = blocks.find((x) => x.id === id(4)) as Block;
    expect(ancestorIn(blocks, list, deep)?.id).toBe(id(1));
    expect(withDescendants(blocks, [id(1)])).toEqual(new Set([id(1), id(2), id(3), id(4)]));
  });
});
