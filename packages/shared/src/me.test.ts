import { describe, expect, it } from "vitest";
import { isValidTimeZone, resolveWeekStart, updateMeSchema, weekdayFromIso } from "./me.ts";
import { sniffImageMime } from "./files.ts";

const meta = { clientMutationId: "0193a6f0-0000-7000-8000-000000000000", baseVersion: 1 };

describe("resolveWeekStart", () => {
  it("uses the explicit preference", () => {
    expect(resolveWeekStart("mon", 0)).toBe(1);
    expect(resolveWeekStart("sun", 1)).toBe(0);
    expect(resolveWeekStart("sat", 1)).toBe(6);
  });
  it("falls back to the system day", () => {
    expect(resolveWeekStart("system", 0)).toBe(0);
    expect(resolveWeekStart("system", 6)).toBe(6);
  });
  it("converts Intl ISO days", () => {
    expect(weekdayFromIso(1)).toBe(1);
    expect(weekdayFromIso(7)).toBe(0);
    expect(weekdayFromIso(6)).toBe(6);
  });
});

describe("isValidTimeZone", () => {
  it.each(["UTC", "Europe/Berlin", "Asia/Kolkata", "America/Argentina/Buenos_Aires"])(
    "accepts %s",
    (tz) => {
      expect(isValidTimeZone(tz)).toBe(true);
    },
  );
  it.each(["", "Mars/Olympus", "Europe/Berlin; drop table"])("rejects %j", (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});

describe("updateMeSchema", () => {
  it("needs at least one field", () => {
    expect(updateMeSchema.safeParse(meta).success).toBe(false);
  });
  it("trims names and rejects an empty first name", () => {
    expect(updateMeSchema.parse({ ...meta, firstName: "  Ada " }).firstName).toBe("Ada");
    expect(updateMeSchema.safeParse({ ...meta, firstName: "   " }).success).toBe(false);
  });
  it("allows clearing the last name and the avatar", () => {
    expect(updateMeSchema.safeParse({ ...meta, lastName: "" }).success).toBe(true);
    expect(updateMeSchema.safeParse({ ...meta, avatarFileId: null }).success).toBe(true);
  });
  it("rejects unknown time zones", () => {
    expect(updateMeSchema.safeParse({ ...meta, timezone: "Nowhere/City" }).success).toBe(false);
  });
});

describe("sniffImageMime", () => {
  const bytes = (...b: (number | string)[]) =>
    new Uint8Array(
      b.flatMap((x) =>
        typeof x === "string" ? Array.from({ length: x.length }, (_, i) => x.charCodeAt(i)) : [x],
      ),
    );
  it("detects the supported images", () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageMime(bytes(0x89, "PNG\r\n\x1a\n"))).toBe("image/png");
    expect(sniffImageMime(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffImageMime(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
  });
  it("rejects anything else", () => {
    expect(sniffImageMime(bytes("<svg xmlns"))).toBeNull();
    expect(sniffImageMime(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});
