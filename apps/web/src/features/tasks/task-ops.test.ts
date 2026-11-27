import { textInline, type Block } from "@flolist/shared";
import { describe, expect, it } from "vitest";
import {
  completeOps,
  duplicateOps,
  taskFieldOps,
  toLinks,
  toMarkdown,
  toPlainText,
  topLevel,
} from "./task-ops.ts";

const listId = "0190a5d2-7c1e-7000-8000-00000000aaaa";
const id = (n: number) => `0190a5d2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const done = { completedAt: "2026-11-26T10:00:00.000Z", completedBy: null };

function b(n: number, over: Partial<Block> = {}): Block {
  return {
    id: id(n),
    containerType: "list",
    containerId: listId,
    rootListId: listId,
    position: `a${String(n)}`,
    type: "paragraph",
    indent: 0,
    content: { inline: textInline(`T${String(n)}`) },
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

// 1 (due, high, labelled, done) > 2 (subtask, done) > 4 (sub-subtask); 1's body has text 3.
const due = { date: "2026-12-01", time: null, tz: "UTC" };
const blocks = [
  task(1, {
    task: { ...done, due, priority: 3, labelIds: [id(900)] },
  }),
  task(2, { ...inTask(1), position: "a0", task: { ...done, due, priority: 0, labelIds: [] } }),
  b(3, { ...inTask(1), position: "a1" }),
  task(4, { ...inTask(2), position: "a0" }),
  task(5),
  b(6),
];
const byN = (n: number) => blocks.find((x) => x.id === id(n)) as Block;

describe("topLevel", () => {
  it("drops subtasks whose parent task is selected too", () => {
    expect(topLevel(blocks, [byN(1), byN(2), byN(4), byN(5)]).map((x) => x.id)).toEqual([
      id(1),
      id(5),
    ]);
    expect(topLevel(blocks, [byN(4), byN(5)]).map((x) => x.id)).toEqual([id(4), id(5)]);
  });
});

describe("duplicateOps", () => {
  it("copies a task with its body and subtasks: incomplete, undated, priority and labels kept", () => {
    const { ops, ids } = duplicateOps(blocks, [byN(1)]);
    expect(ids).toHaveLength(1);
    expect(ops).toHaveLength(4);
    const [top, sub, subsub, text] = ops.map((o) => (o.op === "upsert" ? o.fields : {}));
    expect(top).toMatchObject({ type: "task", priority: 3, labelIds: [id(900)] });
    expect(top).not.toHaveProperty("due");
    expect(top).not.toHaveProperty("completed");
    expect(top?.position && top.position > "a1" && top.position < "a5").toBe(true);
    expect(sub).toMatchObject({ container: { type: "task", id: top?.taskId }, position: "a0" });
    expect(sub?.taskId).not.toBe(id(102));
    expect(text).toMatchObject({ type: "paragraph", container: { id: top?.taskId } });
    expect(subsub).toMatchObject({ container: { type: "task", id: sub?.taskId } });
  });

  it("keeps a duplicated subtask in its parent and skips sublists", () => {
    const sublist = b(7, { type: "sublist", sublistId: id(700), content: {} as Block["content"] });
    const { ops } = duplicateOps([...blocks, sublist], [byN(2), sublist]);
    expect(ops[0]).toMatchObject({
      fields: { container: { type: "task", id: id(101) } },
    });
    expect(ops.every((o) => o.op === "upsert" && o.fields.type !== "sublist")).toBe(true);
  });
});

describe("completeOps", () => {
  it("completes all unless every task already is, and skips text blocks", () => {
    expect(completeOps([byN(1), byN(5), byN(6)])).toEqual({
      completed: true,
      ops: [{ op: "upsert", id: id(5), fields: { completed: true } }],
    });
    expect(completeOps([byN(1), byN(2)]).completed).toBe(false);
  });

  it("taskFieldOps only touches tasks", () => {
    expect(taskFieldOps([byN(5), byN(6)], { due: null })).toEqual([
      { op: "upsert", id: id(5), fields: { due: null } },
    ]);
  });
});

describe("copy", () => {
  it("writes nested Markdown checklists", () => {
    expect(toMarkdown(blocks, [byN(1), byN(5)])).toBe(
      ["- [x] T1", "    - [x] T2", "        - [ ] T4", "- [ ] T5"].join("\n"),
    );
  });

  it("writes indented plain text", () => {
    expect(toPlainText(blocks, [byN(1), byN(6)])).toBe(["T1", "  T2", "    T4", "T6"].join("\n"));
  });

  it("writes one details link per task", () => {
    expect(toLinks("https://app.test", listId, [byN(1), byN(6), byN(5)])).toBe(
      [
        `https://app.test/lists/${listId}/tasks/${id(101)}`,
        `https://app.test/lists/${listId}/tasks/${id(105)}`,
      ].join("\n"),
    );
  });
});
