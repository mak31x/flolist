import {
  DEFAULT_LIST_VIEW_PREFS,
  type InboxPage,
  type Task,
  type TodayPage,
} from "@flolist/shared";
import { describe, expect, it } from "vitest";
import { inboxRows, sortRows, todayGroups } from "./rows.ts";

let n = 0;
function task(values: Partial<Task> = {}): Task {
  n += 1;
  const id = `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    workspaceId: "00000000-0000-7000-8000-000000000999",
    listId: null,
    rootListId: null,
    parentTaskId: null,
    blockId: null,
    title: `Task ${String(n)}`,
    titleInline: [{ type: "text", text: `Task ${String(n)}` }],
    completedAt: null,
    completedBy: null,
    due: null,
    priority: 0,
    labelIds: [],
    createdBy: null,
    createdAt: new Date(2026, 10, 1, 0, 0, n).toISOString(),
    updatedAt: new Date(2026, 10, 1).toISOString(),
    version: 1,
    ...values,
  };
}

const item = (taskId: string, position: string) => ({
  taskId,
  position,
  reason: "manual" as const,
  addedAt: new Date().toISOString(),
  version: 1,
});

describe("inboxRows", () => {
  it("orders items by position and nests subtasks by their positions", () => {
    const a = task();
    const b = task();
    const subLate = task({ parentTaskId: a.id });
    const subEarly = task({ parentTaskId: a.id });
    const subSub = task({ parentTaskId: subEarly.id, completedAt: new Date().toISOString() });
    const page: InboxPage = {
      items: [item(b.id, "a2"), item(a.id, "a1")],
      tasks: [a, b, subLate, subEarly, subSub],
      positions: { [subLate.id]: "a5", [subEarly.id]: "a1" },
    };
    const rows = inboxRows(page);
    expect(rows.map((r) => [r.task.id, r.depth])).toEqual([
      [a.id, 0],
      [subEarly.id, 1],
      [subSub.id, 2],
      [subLate.id, 1],
      [b.id, 0],
    ]);
    expect(rows[0]?.progress).toEqual({ done: 0, total: 2 });
    expect(rows[1]?.progress).toEqual({ done: 1, total: 1 });
    // Collapsing hides the subtree.
    expect(inboxRows(page, new Set([a.id])).map((r) => r.task.id)).toEqual([a.id, b.id]);
  });

  it("hides completed tasks (and their subtasks) with Hide completed", () => {
    const done = task({ completedAt: new Date().toISOString() });
    const sub = task({ parentTaskId: done.id });
    const open = task();
    const page: InboxPage = {
      items: [item(done.id, "a0"), item(open.id, "a1")],
      tasks: [done, sub, open],
      positions: {},
    };
    const rows = sortRows(
      inboxRows(page),
      { ...DEFAULT_LIST_VIEW_PREFS, hideCompleted: true },
      null,
      () => undefined,
    );
    expect(rows.map((r) => r.task.id)).toEqual([open.id]);
  });
});

describe("todayGroups", () => {
  const due = (date: string) => ({ date, time: null, tz: "UTC" });

  it("splits overdue from today and follows the manual order first", () => {
    const late = task({ due: due("2026-11-20") });
    const first = task({ due: due("2026-11-28") });
    const second = task({ due: due("2026-11-28") });
    const page: TodayPage = {
      date: "2026-11-28",
      open: [late, second, first],
      completed: [],
      order: { [first.id]: "a0" },
    };
    const groups = todayGroups(page, "2026-11-28");
    expect(groups.overdue.map((x) => x.id)).toEqual([late.id]);
    expect(groups.today.map((x) => x.id)).toEqual([first.id, second.id]);
  });

  it("moves rows completed or rescheduled here at once", () => {
    const doneNow = task({ due: due("2026-11-28"), completedAt: new Date().toISOString() });
    const movedAway = task({ due: due("2026-11-30") });
    const page: TodayPage = {
      date: "2026-11-28",
      open: [doneNow, movedAway],
      completed: [],
      order: {},
    };
    const groups = todayGroups(page, "2026-11-28");
    expect(groups.today).toEqual([]);
    expect(groups.completed.map((x) => x.id)).toEqual([doneNow.id]);
    // On another day's page a completion doesn't land in that day's Completed tab.
    expect(todayGroups({ ...page, date: "2026-11-29" }, "2026-11-28").completed).toEqual([]);
  });
});
