import { describe, expect, it } from "vitest";
import { emphasisSpans, emphasisWords, plainCopy } from "@/lib/carousels/emphasis";

describe("keyword emphasis", () => {
  it("splits copy into plain and bold spans", () => {
    expect(emphasisSpans("Month closes at **$3,195** after **64 days**")).toEqual([
      { text: "Month closes at ", strong: false },
      { text: "$3,195", strong: true },
      { text: " after ", strong: false },
      { text: "64 days", strong: true }
    ]);
  });

  it("leaves an unclosed marker as typed instead of bolding the rest of the line", () => {
    expect(emphasisSpans("half **open")).toEqual([{ text: "half **open", strong: false }]);
  });

  it("reads copy without its markers for anything that matches words", () => {
    expect(plainCopy("The **agent terminal** broke")).toBe("The agent terminal broke");
    expect(plainCopy(undefined)).toBe("");
  });

  it("keeps a bold phrase bold on every word and punctuation on the word it follows", () => {
    const words = emphasisWords("Fixed **all platforms**. Done");
    expect(words.map((word) => word.map((piece) => piece.text).join(""))).toEqual(["Fixed", "all", "platforms.", "Done"]);
    expect(words[1]).toEqual([{ text: "all", strong: true }]);
    expect(words[2]).toEqual([
      { text: "platforms", strong: true },
      { text: ".", strong: false }
    ]);
  });
});
