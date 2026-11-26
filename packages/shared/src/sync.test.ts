import { describe, expect, it } from "vitest";
import { changeEventSchema, clientMessageSchema, serverMessageSchema } from "./sync.ts";

const id = "0190a5d2-7c1e-7000-8000-000000000001";

describe("sync messages", () => {
  it("parses upserts and deletes of every entity", () => {
    const section = {
      type: "change",
      op: "upsert",
      entity: "section",
      id,
      version: 2,
      clientMutationId: null,
      data: { id, title: "Work", position: "a0", collapsed: false, isDefault: false, version: 2 },
    };
    expect(changeEventSchema.parse(section)).toEqual(section);
    const del = {
      type: "change",
      op: "delete",
      entity: "list",
      id,
      version: 3,
      clientMutationId: id,
    };
    expect(serverMessageSchema.parse(del)).toEqual(del);
    expect(changeEventSchema.safeParse({ ...section, entity: "list" }).success).toBe(false);
  });

  it("accepts only list channels from clients", () => {
    expect(
      clientMessageSchema.safeParse({ type: "subscribe", channel: `list:${id}` }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({ type: "subscribe", channel: `user:${id}` }).success,
    ).toBe(false);
  });
});
