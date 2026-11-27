import { describe, expect, it } from "vitest";
import { createLabelSchema, labelNameSchema, normalizeLabelName } from "./labels.ts";
import { dueTimeSchema, taskFieldsInputSchema, taskLabelIdsSchema } from "./task-fields.ts";
import { uuidv7 } from "./uuid.ts";

describe("label names", () => {
  it("normalizes", () => {
    expect(normalizeLabelName("  #Deep   work ")).toBe("Deep work");
    expect(labelNameSchema.parse("##urgent")).toBe("urgent");
  });

  it("refuses empty and long names", () => {
    expect(labelNameSchema.safeParse("  # ").success).toBe(false);
    expect(labelNameSchema.safeParse("x".repeat(51)).success).toBe(false);
  });

  it("parses a create body", () => {
    const body = { clientMutationId: uuidv7(), id: uuidv7(), workspaceId: uuidv7(), name: " Home" };
    expect(createLabelSchema.parse(body).name).toBe("Home");
    expect(createLabelSchema.safeParse({ ...body, color: "pink" }).success).toBe(false);
  });
});

describe("task fields", () => {
  it("accepts HH:mm times only", () => {
    expect(dueTimeSchema.safeParse("17:00").success).toBe(true);
    expect(dueTimeSchema.safeParse("7:00").success).toBe(false);
    expect(dueTimeSchema.safeParse("24:00").success).toBe(false);
    expect(dueTimeSchema.safeParse("17:00:00").success).toBe(false);
  });

  it("validates due dates, priority and labels", () => {
    expect(taskFieldsInputSchema.safeParse({ due: { date: "2026-11-28" } }).success).toBe(true);
    expect(taskFieldsInputSchema.safeParse({ due: null }).success).toBe(true);
    expect(taskFieldsInputSchema.safeParse({ due: { date: "2026-02-30" } }).success).toBe(false);
    expect(
      taskFieldsInputSchema.safeParse({ due: { date: "2026-11-28", tz: "Mars/Base" } }).success,
    ).toBe(false);
    expect(taskFieldsInputSchema.safeParse({ priority: 4 }).success).toBe(false);
    const id = uuidv7();
    expect(taskLabelIdsSchema.safeParse([id, id]).success).toBe(false);
  });
});
