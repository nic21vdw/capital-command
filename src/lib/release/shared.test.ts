import { describe, expect, it } from "vitest";
import {
  parsePendingCommits,
  parseUnreleased,
  shouldShowBanner,
  updateCheckState
} from "./shared";

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

describe("shouldShowBanner", () => {
  const waiting = {
    releasable: true,
    latest: "b39dc4f",
    pending: [{ commit: "b39dc4f", subject: "Reschedule from the calendar" }]
  };

  it("shows when the production checkout is behind the release branch", () => {
    expect(shouldShowBanner(waiting)).toBe(true);
  });

  it("stays silent in a sandbox worktree, however far behind it is", () => {
    expect(shouldShowBanner({ ...waiting, releasable: false })).toBe(false);
  });

  it("stays silent when the running build is already the latest", () => {
    expect(shouldShowBanner({ ...waiting, pending: [] })).toBe(false);
  });

  it("stays silent before the first poll has answered", () => {
    expect(shouldShowBanner(null)).toBe(false);
  });

  it("honours a dismissal only until the next commit lands", () => {
    expect(shouldShowBanner(waiting, { dismissed: "b39dc4f" })).toBe(false);
    expect(shouldShowBanner(waiting, { dismissed: "0000000" })).toBe(true);
  });

  it("stays up while the release runs, even once nothing is pending", () => {
    expect(shouldShowBanner({ ...waiting, pending: [] }, { busy: true })).toBe(true);
    expect(shouldShowBanner(waiting, { dismissed: "b39dc4f", busy: true })).toBe(true);
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

describe("updateCheckState", () => {
  const releasable = { releasable: true, pending: [{ commit: "a1b2c3d", subject: "A change" }] };

  it("says nothing until a check has come back", () => {
    expect(updateCheckState(null, "idle")).toBe("unknown");
  });

  it("separates up to date from an update waiting", () => {
    expect(updateCheckState(releasable, "idle")).toBe("available");
    expect(updateCheckState({ ...releasable, pending: [] }, "idle")).toBe("up-to-date");
  });

  it("never claims a sandbox is up to date", () => {
    expect(updateCheckState({ releasable: false, pending: [] }, "idle")).toBe("elsewhere");
    expect(updateCheckState({ ...releasable, releasable: false }, "idle")).toBe("elsewhere");
  });

  it("shows the release running whatever the last poll said was pending", () => {
    expect(updateCheckState({ ...releasable, pending: [] }, "starting")).toBe("updating");
    expect(updateCheckState({ ...releasable, pending: [] }, "updating")).toBe("updating");
    expect(updateCheckState(null, "updating")).toBe("updating");
  });

  it("reports a check in flight over whatever it is about to replace", () => {
    expect(updateCheckState(releasable, "checking")).toBe("checking");
  });
});
