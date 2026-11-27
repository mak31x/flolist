import {
  DEFAULT_LIST_VIEW_PREFS,
  textInline,
  type Block,
  type ListViewPrefs,
} from "@flolist/shared";
import { describe, expect, it } from "vitest";
import { openTaskCount, viewBlocks } from "./list-view.ts";

const block = (id: string, text: string | null, type: Block["type"] = "paragraph"): Block => ({
  id,
  containerType: "list",
  containerId: "l",
  rootListId: "l",
  position: `a${id}`,
  type,
  indent: 0,
  content: text === null ? { color: "gray" } : { inline: textInline(text) },
  fileId: null,
  sublistId: null,
  taskId: null,
  task: null,
  createdBy: null,
  version: 1,
  createdAt: "",
  updatedAt: "",
});

describe("viewBlocks", () => {
  const rows = [
    block("1", "pear"),
    block("2", null, "divider"),
    block("3", "Apple"),
    block("4", "banana 10"),
    block("5", "banana 9"),
  ];

  it("keeps the stored order by default", () => {
    expect(viewBlocks(rows, DEFAULT_LIST_VIEW_PREFS)).toBe(rows);
  });

  it("sorts by text, case- and number-aware, with textless blocks last", () => {
    const sorted = viewBlocks(rows, { ...DEFAULT_LIST_VIEW_PREFS, sort: "alphabetical" });
    expect(sorted.map((b) => b.id)).toEqual(["3", "5", "4", "1", "2"]);
    expect(rows.map((b) => b.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("shows only tasks when asked", () => {
    expect(viewBlocks(rows, { ...DEFAULT_LIST_VIEW_PREFS, tasksOnly: true })).toEqual([]);
  });
});

describe("viewBlocks with tasks", () => {
  const task = (id: string, text: string, over: Partial<Block> = {}): Block => ({
    ...block(id, text, "task"),
    taskId: `t${id}`,
    task: { completedAt: null, completedBy: null, due: null, priority: 0, labelIds: [] },
    ...over,
  });
  const done = (at: string) => ({
    task: { completedAt: at, completedBy: "me", due: null, priority: 0, labelIds: [] },
  });
  const rows = [
    task("1", "Write", { createdAt: "2026-11-01", createdBy: "other" }),
    task("2", "sub of write", done("2026-11-03T00:00:00Z")),
    block("3", "notes"),
    task("4", "Call", {
      ...done("2026-11-02T00:00:00Z"),
      createdAt: "2026-11-03",
      createdBy: "me",
    }),
    task("5", "sub of call"),
    task("6", "Buy", { ...done("2026-11-05T00:00:00Z"), createdAt: "2026-11-02" }),
  ];
  const depth = new Map([
    ["2", 1],
    ["5", 1],
  ]);
  const ids = (out: readonly Block[]) => out.map((b) => b.id);

  it("Show tasks only drops text, keeping subtasks", () => {
    expect(ids(viewBlocks(rows, { ...DEFAULT_LIST_VIEW_PREFS, tasksOnly: true }, depth))).toEqual([
      "1",
      "2",
      "4",
      "5",
      "6",
    ]);
  });

  it("Hide completed drops completed tasks and their subtasks", () => {
    expect(
      ids(viewBlocks(rows, { ...DEFAULT_LIST_VIEW_PREFS, hideCompleted: true }, depth)),
    ).toEqual(["1", "3"]);
  });

  it("sorts top-level rows and keeps subtasks under their task", () => {
    const sort = (s: "alphabetical" | "creator" | "created" | "completed") =>
      ids(viewBlocks(rows, { ...DEFAULT_LIST_VIEW_PREFS, sort: s }, depth, "me"));
    expect(sort("alphabetical")).toEqual(["6", "4", "5", "3", "1", "2"]);
    expect(sort("creator")).toEqual(["4", "5", "3", "6", "1", "2"]);
    expect(sort("created")).toEqual(["4", "5", "6", "1", "2", "3"]);
    expect(sort("completed")).toEqual(["1", "2", "3", "6", "4", "5"]);
  });

  it("counts open tasks for sublist rows", () => {
    expect(openTaskCount(rows)).toBe(2);
  });
});

describe("task-field sorts", () => {
  const due = (date: string, time: string | null = null) => ({ date, time, tz: "UTC" });
  const row = (id: number, task: Partial<NonNullable<Block["task"]>>): Block => ({
    ...block(String(id), `t${String(id)}`, "task"),
    taskId: `t${String(id)}`,
    task: { completedAt: null, completedBy: null, due: null, priority: 0, labelIds: [], ...task },
  });
  const ids = (rows: readonly Block[]) => rows.map((b) => b.id);
  const prefs = (sort: ListViewPrefs["sort"]): ListViewPrefs => ({
    sort,
    hideCompleted: false,
    tasksOnly: false,
  });

  it("sorts by priority, due date and label", () => {
    const a = row(1, { priority: 1, due: due("2026-12-02"), labelIds: ["l-b"] });
    const b = row(2, { priority: 3, due: due("2026-12-01") });
    const c = row(3, { due: due("2026-12-01", "09:00"), labelIds: ["l-a"] });
    const d = row(4, {});
    expect(ids(viewBlocks([a, b, c, d], prefs("priority")))).toEqual(ids([b, a, c, d]));
    expect(ids(viewBlocks([a, b, c, d], prefs("due")))).toEqual(ids([c, b, a, d]));
    const names: Record<string, string> = { "l-a": "Alpha", "l-b": "Beta" };
    expect(
      ids(viewBlocks([a, b, c, d], prefs("label"), new Map(), null, (id) => names[id])),
    ).toEqual(ids([c, a, b, d]));
  });
});
