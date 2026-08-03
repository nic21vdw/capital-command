import { describe, expect, it } from "vitest";
import { sanitizeFolderName } from "./drive";

describe("sanitizeFolderName", () => {
  it("strips characters Windows and macOS reject in folder names", () => {
    expect(sanitizeFolderName('Stream: "Best" of <2024>')).toBe("Stream Best of 2024");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeFolderName("  My   Big    Stream  ")).toBe("My Big Stream");
  });

  it("drops a trailing dot that Windows would silently strip", () => {
    expect(sanitizeFolderName("Episode 12.")).toBe("Episode 12");
  });

  it("keeps ordinary punctuation intact", () => {
    expect(sanitizeFolderName("Live - Q&A night")).toBe("Live - Q&A night");
  });

  it("falls back when nothing usable remains", () => {
    expect(sanitizeFolderName("///")).toBe("Untitled stream");
    expect(sanitizeFolderName("   ")).toBe("Untitled stream");
  });

  it("caps very long titles so the path stays valid", () => {
    expect(sanitizeFolderName("a".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});
