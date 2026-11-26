import { DEFAULT_LIST_VIEW_PREFS, textInline, type Block } from "@flolist/shared";
import { describe, expect, it } from "vitest";
import { viewBlocks } from "./list-view.ts";

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

  it("shows only tasks when asked (none exist before M3.1)", () => {
    expect(viewBlocks(rows, { ...DEFAULT_LIST_VIEW_PREFS, tasksOnly: true })).toEqual([]);
  });
});
