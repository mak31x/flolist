import { describe, expect, it } from "vitest";
import { phraseAtCaret } from "./suggestion.ts";

const opts = {
  now: new Date("2026-11-27T15:30:00Z"),
  timeZone: "Asia/Kolkata",
  weekStart: 1 as const,
};

describe("phraseAtCaret", () => {
  it("offers the phrase that ends at the caret", () => {
    const text = "pay rent tomorrow at 5pm";
    expect(phraseAtCaret(text, text.length, opts)).toMatchObject({
      text: "tomorrow at 5pm",
      date: "2026-11-28",
      time: "17:00",
    });
    // A trailing space still counts.
    expect(phraseAtCaret(`${text} `, text.length + 1, opts)?.text).toBe("tomorrow at 5pm");
  });

  it("hides once typing goes on, or the caret is elsewhere", () => {
    const text = "pay rent tomorrow and more";
    expect(phraseAtCaret(text, text.length, opts)).toBeNull();
    expect(phraseAtCaret("pay rent tomorrow", 3, opts)).toBeNull();
  });

  it("doesn't offer repeats yet", () => {
    expect(phraseAtCaret("gym every monday", 16, opts)).toBeNull();
  });
});
