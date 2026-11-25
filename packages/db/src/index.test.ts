import { describe, expect, it } from "vitest";
import { databaseName } from "./index.ts";

describe("databaseName", () => {
  it("reads the database from a URL", () => {
    expect(databaseName("postgres://u:p@localhost:5432/flolist")).toBe("flolist");
  });

  it("throws when the database is missing", () => {
    expect(() => databaseName("postgres://u:p@localhost:5432")).toThrow();
  });
});
