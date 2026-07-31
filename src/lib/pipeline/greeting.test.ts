import { describe, expect, it } from "vitest";
import { PIPELINE_QUOTES, quoteOfTheDay } from "@/lib/pipeline/greeting";

describe("quoteOfTheDay", () => {
  it("gives the same line all day and a different one tomorrow", () => {
    const morning = quoteOfTheDay(new Date(2026, 6, 29, 6, 12));
    const evening = quoteOfTheDay(new Date(2026, 6, 29, 23, 58));
    expect(morning).toBe(evening);
    expect(quoteOfTheDay(new Date(2026, 6, 30, 6, 12))).not.toBe(morning);
  });

  it("walks the whole list before repeating a line", () => {
    const seen = new Set<string>();
    for (let day = 0; day < PIPELINE_QUOTES.length; day += 1) {
      seen.add(quoteOfTheDay(new Date(2026, 0, 1 + day)));
    }
    expect(seen.size).toBe(PIPELINE_QUOTES.length);
  });

  it("always returns a line from the list", () => {
    for (const date of [new Date(1970, 0, 1), new Date(1969, 5, 20), new Date(2031, 11, 31)]) {
      expect(PIPELINE_QUOTES).toContain(quoteOfTheDay(date));
    }
  });
});
