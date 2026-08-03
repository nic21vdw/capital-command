import { describe, expect, it } from "vitest";
import { parsePendingCommits, parseUnreleased } from "./status";

const CHANGELOG = `# Changelog

Preamble that mentions **Unreleased** in passing.

## Unreleased

- **The app tells you when there is an update.** A banner appears at the top
  of every screen when dev has work the running build does not.

- **Instagram posts clips queued before hosting was set up.** It uploads the
  clip at post time instead.

## 2026-08-02

- **Buttons work again.** Two separate causes, both fixed.
`;

describe("parseUnreleased", () => {
  it("takes the bolded headline of each Unreleased bullet", () => {
    expect(parseUnreleased(CHANGELOG)).toEqual([
      "The app tells you when there is an update.",
      "Instagram posts clips queued before hosting was set up."
    ]);
  });

  it("stops at the next dated release", () => {
    expect(parseUnreleased(CHANGELOG)).not.toContain("Buttons work again.");
  });

  it("is empty when the release carried nothing anyone wrote up", () => {
    expect(parseUnreleased("# Changelog\n\n## Unreleased\n\n## 2026-08-02\n\n- Something.\n")).toEqual([]);
    expect(parseUnreleased("# Changelog\n\n## 2026-08-02\n\n- Something.\n")).toEqual([]);
  });

  it("falls back to the first sentence when a bullet has no bolded lead", () => {
    const notes = parseUnreleased("## Unreleased\n\n- Captions no longer drift. The offset was wrong.\n");
    expect(notes).toEqual(["Captions no longer drift."]);
  });

  it("reads a file written with CRLF line endings", () => {
    expect(parseUnreleased(CHANGELOG.replace(/\n/g, "\r\n"))).toEqual([
      "The app tells you when there is an update.",
      "Instagram posts clips queued before hosting was set up."
    ]);
  });
});

describe("parsePendingCommits", () => {
  it("splits git log's short format into commit and subject", () => {
    expect(parsePendingCommits("57c6330 Stop whatever holds port 3000\n550cb61 Give each session its own checkout")).toEqual([
      { commit: "57c6330", subject: "Stop whatever holds port 3000" },
      { commit: "550cb61", subject: "Give each session its own checkout" }
    ]);
  });

  it("reads no commits as nothing pending, not as one blank commit", () => {
    expect(parsePendingCommits("")).toEqual([]);
    expect(parsePendingCommits("\n\n")).toEqual([]);
  });
});
