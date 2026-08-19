import { describe, expect, it } from "vitest";
import {
  parsePendingCommits,
  parseUnreleased,
  shouldShowBanner,
  updateCheckState,
  releaseStillRunning,
  shouldShowUpdated,
  watchRelease,
  RELEASE_ABANDONED_AFTER_SECONDS,
  RELEASE_LOST_AFTER_SECONDS,
  RELEASE_SLOW_AFTER_SECONDS
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

describe("releaseStillRunning", () => {
  const running = { failed: null, finished: false, quietFor: 5 };

  it("is running while the log is moving and says nothing final", () => {
    expect(releaseStillRunning(true, running)).toBe(true);
  });

  it("is over once it has written why it stopped", () => {
    expect(releaseStillRunning(true, { ...running, failed: "npm install failed." })).toBe(false);
  });

  it("is over once it reports a running app", () => {
    expect(releaseStillRunning(true, { ...running, finished: true })).toBe(false);
  });

  // The failure mode this whole function exists for: without it the flag stays
  // set for the life of the server and every retry is refused.
  it("is over once it has gone quiet for longer than any step takes", () => {
    expect(releaseStillRunning(true, { ...running, quietFor: RELEASE_ABANDONED_AFTER_SECONDS + 1 })).toBe(false);
  });

  it("is not running if this process never started one", () => {
    expect(releaseStillRunning(false, running)).toBe(false);
  });
});

describe("watchRelease", () => {
  const startedAt = Date.parse("2026-08-18T23:25:00.000Z");
  const at = (seconds: number) => startedAt + seconds * 1000;
  const building = { step: "Building and starting the new version", startedAt };

  it("counts the update up rather than repeating the last step forever", () => {
    const watch = watchRelease({ ...building, offline: true, now: at(75) });

    expect(watch.elapsed).toBe("1m 15s");
    expect(watch.headline).toContain("1m 15s");
    expect(watch.tone).toBe("working");
  });

  // The server is stopped BY the update, so a failed poll is the normal middle
  // of one. Reading it as a fault is what made a working release look broken.
  it("treats the app being down as part of the update, not a failure", () => {
    const watch = watchRelease({ ...building, offline: true, now: at(30) });

    expect(watch.tone).toBe("working");
    expect(watch.detail).toContain("rebuilds");
  });

  it("says a long build is still a build", () => {
    const watch = watchRelease({ ...building, offline: true, now: at(RELEASE_SLOW_AFTER_SECONDS + 1) });

    expect(watch.tone).toBe("slow");
    expect(watch.spin).toBe(true);
  });

  // The complaint this exists for: a spinner that had been going for twenty
  // minutes said exactly what it said at four seconds.
  it("stops claiming an update is on its way once it has not come back", () => {
    const watch = watchRelease({ ...building, offline: true, now: at(RELEASE_LOST_AFTER_SECONDS) });

    expect(watch.tone).toBe("lost");
    expect(watch.spin).toBe(false);
    expect(watch.detail).toContain("update-app.log");
  });

  it("shows the reason a release wrote down over any clock", () => {
    const watch = watchRelease({
      ...building,
      failed: "npm install failed.",
      offline: false,
      now: at(20)
    });

    expect(watch.tone).toBe("lost");
    expect(watch.detail).toBe("npm install failed.");
  });

  it("still says something before the log has been read", () => {
    const watch = watchRelease({ step: null, startedAt: null, offline: false, now: at(5) });

    expect(watch.headline).toBe("Starting the update");
    expect(watch.elapsed).toBeNull();
  });
});

describe("shouldShowUpdated", () => {
  const landed = { releasable: true, running: "abc123" };
  const finished = { finished: true, quietFor: 20 };

  it("says the update landed", () => {
    expect(shouldShowUpdated(landed, finished)).toBe(true);
  });

  it("says nothing about a release that never finished", () => {
    expect(shouldShowUpdated(landed, { finished: false, quietFor: 20 })).toBe(false);
  });

  // Otherwise every visit for the rest of the week opens on the news that an
  // update once worked.
  it("forgets an old release, and one already acknowledged", () => {
    expect(shouldShowUpdated(landed, { finished: true, quietFor: 4000 })).toBe(false);
    expect(shouldShowUpdated(landed, finished, { acknowledged: "abc123" })).toBe(false);
    expect(shouldShowUpdated(landed, finished, { acknowledged: "older1" })).toBe(true);
  });

  it("stays out of a sandbox", () => {
    expect(shouldShowUpdated({ ...landed, releasable: false }, finished)).toBe(false);
  });
});
