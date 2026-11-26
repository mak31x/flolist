import { describe, expect, it } from "vitest";
import { resolveBlockShape, textInline, upsertBlockOpSchema } from "./blocks.ts";
import { AVAILABLE_LIST_SORTS } from "./lists.ts";
import { changeEventSchema } from "./sync.ts";
import { MAX_TASK_TITLE, taskTitleText, updateTaskSchema } from "./tasks.ts";

const id = (n: number) => `0190a5d2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;

describe("task titles", () => {
  it("flattens hard breaks and trims", () => {
    expect(
      taskTitleText([
        { type: "text", text: "  Pay " },
        { type: "hardBreak" },
        { type: "text", text: " rent " },
      ]),
    ).toBe("Pay rent");
  });

  it("caps the title length", () => {
    const ok = updateTaskSchema.safeParse({
      clientMutationId: id(1),
      titleInline: textInline("x".repeat(MAX_TASK_TITLE)),
    });
    const tooLong = updateTaskSchema.safeParse({
      clientMutationId: id(1),
      titleInline: textInline("x".repeat(MAX_TASK_TITLE + 1)),
    });
    expect(ok.success).toBe(true);
    expect(tooLong.success).toBe(false);
  });

  it("needs a field to change", () => {
    expect(updateTaskSchema.safeParse({ clientMutationId: id(1) }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ clientMutationId: id(1), completed: true }).success).toBe(
      true,
    );
  });
});

describe("task blocks", () => {
  it("turn into text and back, keeping the title", () => {
    const task = resolveBlockShape(
      { type: "paragraph", indent: 0, content: { inline: textInline("Buy milk") } },
      { type: "task" },
    );
    expect(task).toEqual({
      ok: true,
      shape: { type: "task", indent: 0, content: { inline: textInline("Buy milk") } },
    });
    const back = resolveBlockShape(
      { type: "task", indent: 0, content: { inline: textInline("Buy milk") } },
      { type: "bullet", indent: 1 },
    );
    expect(back.ok && back.shape).toEqual({
      type: "bullet",
      indent: 1,
      content: { inline: textInline("Buy milk") },
    });
  });

  it("never indent: nesting is by container", () => {
    const r = resolveBlockShape(null, { type: "task", indent: 2 });
    expect(r.ok && r.shape.indent).toBe(0);
  });

  it("upserts carry the task id and a container", () => {
    const op = upsertBlockOpSchema.parse({
      op: "upsert",
      id: id(1),
      type: "task",
      position: "a0",
      task: { id: id(2) },
      container: { type: "task", id: id(3) },
    });
    expect(op.task?.id).toBe(id(2));
    expect(op.container).toEqual({ type: "task", id: id(3) });
  });
});

describe("task sync events and sorts", () => {
  it("accepts task upserts and deletes", () => {
    const now = new Date().toISOString();
    const base = { type: "change", version: 1, clientMutationId: null, id: id(1) } as const;
    expect(
      changeEventSchema.safeParse({
        ...base,
        op: "upsert",
        entity: "task",
        data: {
          id: id(1),
          workspaceId: id(2),
          listId: id(3),
          rootListId: id(3),
          parentTaskId: null,
          blockId: id(4),
          title: "Hi",
          titleInline: textInline("Hi"),
          completedAt: null,
          completedBy: null,
          createdBy: id(5),
          createdAt: now,
          updatedAt: now,
          version: 1,
        },
      }).success,
    ).toBe(true);
    expect(changeEventSchema.safeParse({ ...base, op: "delete", entity: "task" }).success).toBe(
      true,
    );
  });

  it("offers the task-field sorts that work in M3.1", () => {
    expect(AVAILABLE_LIST_SORTS).toEqual([
      "manual",
      "creator",
      "alphabetical",
      "created",
      "completed",
    ]);
  });
});
