import { describe, expect, it } from "vitest";
import { buildAutomationOverview, type AutomationInputs } from "@/lib/automations/overview";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import { threadsConfig } from "@/lib/threads/config";

const now = new Date("2026-10-01T15:00:00Z");

function inputs(): AutomationInputs {
  return {
    controls: {}, outcomes: {}, tasks: {}, runs: [], ledger: { lastScanAt: null, records: [] }, ingestRunning: false,
    queue: [], publisher: testConfig(), threads: threadsConfig(), threadsItems: [], threadsState: {},
    podcast: { automation: { enabled: true, time: "09:00", timeZone: "America/Toronto" }, deliveries: [], nextDueAt: null },
    podcastBlockers: [], spotifyConnected: false, spotifyShowLinked: false, episodes: 0, autoScheduleOvernight: false
  };
}

describe("automation dashboard evidence", () => {
  it("surfaces a Threads queue-save failure even when no item recorded an error", () => {
    const input = inputs();
    input.threads.accounts = [{ id: "primary", label: "Test", userId: "user", accessToken: "test-token", posts: "text", offsetMinutes: 0 }];
    input.tasks.threads = { state: "ready", nextRunAt: "2026-10-01T15:05:00Z", lastRunAt: now.toISOString(), lastResult: 0, schedule: "PT5M" };
    input.threadsState.lastTickAt = now.toISOString();
    input.outcomes.threads = { at: now.toISOString(), status: "failed", detail: "The Threads queue could not be saved. Delivery stopped." };
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "threads")!;
    expect(card.state).toBe("attention");
    expect(card.lastOutcome).toContain("Delivery stopped");
    expect(card.issues.join(" ")).toContain("could not be saved");
  });

  it("counts exposure reply receipts and retry work separately from original posts", () => {
    const input = inputs();
    input.threads.accounts = [{ id: "primary", label: "Test", userId: "user", accessToken: "test-token", posts: "text", offsetMinutes: 0 }];
    const original = {
      id: "reply-pending", batchDate: "2026-10-01", slot: 1, accountId: "primary", version: "text" as const,
      topic: "Custom tools", format: "insight", text: "Build a tool around a repetitive task.",
      publishAt: "2026-10-01T14:55:00Z", publishedAt: "2026-10-01T14:55:00Z", createdAt: "2026-10-01T14:00:00Z",
      status: "published" as const, postId: "parent-1", attempts: 0, plugText: "Explore CoLateral: https://colateralai.com/th"
    };
    input.threadsItems = [
      { ...original, plugAttempts: 1, plugNextAttemptAt: "2026-10-01T15:05:00Z", plugError: "Waiting for Threads" },
      { ...original, id: "reply-delivered", slot: 2, postId: "parent-2", plugPostId: "reply-2" }
    ];
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "threads")!;
    expect(card.counts.find((count) => count.label === "Sent today")?.value).toBe(2);
    expect(card.counts.find((count) => count.label === "Replies published")?.value).toBe(1);
    expect(card.counts.find((count) => count.label === "Replies waiting")?.value).toBe(1);
    expect(card.nextItemAt).toBe("2026-10-01T15:05:00.000Z");
    input.threads.plugReplies = false;
    const disabled = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "threads")!;
    expect(disabled.counts.find((count) => count.label === "Replies waiting")?.value).toBe(0);
    expect(disabled.counts.find((count) => count.label === "Replies published")?.value).toBe(1);
  });

  it("puts the Threads card's Next line on the same row the Threads page calls the next post", () => {
    const input = inputs();
    input.threads.accounts = [{ id: "primary", label: "Test", userId: "user", accessToken: "test-token", posts: "text", offsetMinutes: 0 }];
    const base = { batchDate: "2026-10-01", accountId: "primary", version: "text" as const, topic: "T", format: "insight", text: "x", createdAt: "2026-10-01T10:00:00Z", attempts: 0 };
    input.threadsItems = [
      { ...base, id: "done", slot: 1, status: "published", publishAt: "2026-10-01T13:00:00Z" },
      { ...base, id: "later", slot: 3, status: "pending", publishAt: "2026-10-01T19:00:00Z" },
      { ...base, id: "soon", slot: 2, status: "pending", publishAt: "2026-10-01T17:00:00Z", nextAttemptAt: "2026-10-01T23:00:00Z" },
      { ...base, id: "by-hand", slot: 0, origin: "pipeline", status: "pending", publishAt: "2026-10-01T21:00:00Z" }
    ];
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "threads")!;
    expect(card.nextItemAt).toBe("2026-10-01T17:00:00.000Z");
    expect(card.counts.find((count) => count.label === "Sent today")?.value).toBe(1);
    expect(card.counts.find((count) => count.label === "Waiting today")?.value).toBe(3);
  });

  it("keeps plain words on the cards: no Windows task, heartbeat or tick", () => {
    const input = inputs();
    input.outcomes.pipeline = { at: "2026-10-01T14:00:00Z", status: "completed", detail: "ok" };
    input.threadsState = { lastTickAt: "2026-10-01T10:00:00Z" };
    input.queue = [testItem({ platformIds: ["tiktok"] })];
    input.queue[0].platforms.tiktok = { status: "failed", attempts: 1, error: "invalid_grant" };
    const text = JSON.stringify(buildAutomationOverview(input, now).cards);
    expect(text).not.toMatch(/Windows task|heartbeat|\btick\b|scheduler/i);
  });

  it("shows unknown pipeline and missing task evidence instead of claiming workers are running", () => {
    const overview = buildAutomationOverview(inputs(), now);
    expect(overview.cards.find((card) => card.id === "pipeline")?.state).toBe("unknown");
    expect(overview.cards.find((card) => card.id === "publisher")?.state).toBe("blocked");
    expect(overview.cards.find((card) => card.id === "podcast")?.blockers.join(" ")).toContain("Spotify show has not been linked");
  });

  it("honours a saved pause without suppressing blockers or last outcomes", () => {
    const input = inputs();
    input.controls.publisher = { paused: true, changedAt: now.toISOString() };
    input.outcomes.publisher = { at: now.toISOString(), status: "failed", detail: "Two uploads failed." };
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "publisher")!;
    expect(card.state).toBe("paused");
    expect(card.blockers.length).toBeGreaterThan(0);
    expect(card.lastOutcome).toBe("Two uploads failed.");
  });

  it("uses the 90 second heartbeat cadence and waits five minutes before flagging it stale", () => {
    const input = inputs();
    input.outcomes.pipeline = { at: "2026-10-01T14:58:30Z", status: "completed", detail: "Checked 2 pipeline runs." };
    const card = buildAutomationOverview(input, now).cards[0];
    expect(card.schedule).toContain("90 seconds");
    expect(card.issues).toEqual([]);
    input.outcomes.pipeline.at = "2026-10-01T14:54:00Z";
    expect(buildAutomationOverview(input, now).cards[0].issues.join(" ")).toContain("five minutes");
  });

  it("joins the most recent podcast attempt with its outcome and distinguishes the first episode from a publication blocker", () => {
    const input = inputs();
    input.spotifyShowLinked = true;
    input.podcast.deliveries = [
      { title: "Older attempt", status: "published", publishAt: "2026-09-01T15:00:00Z", lastAttemptAt: "2026-09-01T15:00:00Z" },
      { title: "Latest attempt", status: "failed", publishAt: "2026-10-01T15:00:00Z", lastAttemptAt: "2026-10-01T14:59:00Z", lastError: "Owner email is missing." }
    ];
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "podcast")!;
    expect(card.lastRunAt).toBe("2026-10-01T14:59:00Z");
    expect(card.lastOutcome).toBe("Latest attempt: failed");
    expect(card.blockers).toEqual([]);
    expect(card.issues.join(" ")).toContain("scheduled first delivery can create it");
    expect(card.issues.join(" ")).toContain("Owner email is missing");
  });

  it("surfaces failed Buffer deliveries and accepts configured Buffer without direct platforms", () => {
    const input = inputs();
    input.tasks.publisher = { state: "ready", nextRunAt: "2026-10-01T15:05:00Z", lastRunAt: now.toISOString(), lastResult: 0, schedule: "PT5M" };
    input.outcomes.publisher = { at: now.toISOString(), status: "completed", detail: "A publisher tick ran." };
    input.publisher.platforms = [];
    input.publisher.buffer = { ...input.publisher.buffer, enabled: true, accessToken: "test-buffer-token", profileIds: ["test-profile"] };
    input.queue = [testItem({ platformIds: [], buffer: { status: "failed", attempts: 4, error: "Buffer refused the upload." } })];
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "publisher")!;
    expect(card.blockers).toEqual([]);
    expect(card.state).toBe("attention");
    expect(card.counts.find((count) => count.label === "Failed")?.value).toBe(1);
    expect(card.issues.join(" ")).toContain("Buffer refused the upload");
    expect(JSON.stringify(card)).not.toContain("test-buffer-token");
  });

  it("counts Buffer work before the first pass and includes its retry time", () => {
    const input = inputs();
    input.publisher.buffer = { ...input.publisher.buffer, enabled: true, accessToken: "test-token", profileIds: ["test-profile"] };
    input.queue = [testItem({ id: "new-buffer", platformIds: [], publishAt: "2026-10-02T15:00:00Z" }), testItem({ id: "retry-buffer", platformIds: [], buffer: { status: "pending", attempts: 1, nextAttemptAt: "2026-10-01T15:10:00Z" } })];
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "publisher")!;
    expect(card.counts.find((count) => count.label === "Waiting deliveries")?.value).toBe(2);
    expect(card.nextItemAt).toBe("2026-10-01T15:10:00Z");
  });

  it("flags a stale publisher heartbeat even when the Windows task is enabled", () => {
    const input = inputs();
    input.tasks.publisher = { state: "ready", nextRunAt: "2026-10-01T15:05:00Z", lastRunAt: now.toISOString(), lastResult: 0, schedule: "PT5M" };
    input.outcomes.publisher = { at: "2026-10-01T14:30:00Z", status: "completed", detail: "An old tick ran." };
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "publisher")!;
    expect(card.state).toBe("attention");
    expect(card.issues.join(" ")).toContain("The publisher has not run in over 15 minutes");
  });

  it("tells Nic the exact command for a missing task and shows the interval in words", () => {
    const input = inputs();
    input.tasks.publisher = { state: "missing", nextRunAt: null, lastRunAt: null, lastResult: null, schedule: null };
    input.tasks.threads = { state: "missing", nextRunAt: null, lastRunAt: null, lastResult: null, schedule: null };
    input.tasks.ingest = { state: "missing", nextRunAt: null, lastRunAt: null, lastResult: null, schedule: null };
    const cards = buildAutomationOverview(input, now).cards;
    expect(cards.find((card) => card.id === "publisher")!.blockers.join(" ")).toContain("Runner not installed - run npm run publish:register in the app folder");
    expect(cards.find((card) => card.id === "threads")!.blockers.join(" ")).toContain("run npm run threads:register in the app folder");
    expect(cards.find((card) => card.id === "ingest")!.blockers.join(" ")).toContain("run npm run ingest:register in the app folder");
    expect(cards.find((card) => card.id === "podcast")!.registerCommand).toBeUndefined();
    input.tasks.publisher = { state: "ready", nextRunAt: null, lastRunAt: null, lastResult: 0, schedule: "PT5M" };
    expect(buildAutomationOverview(input, now).cards.find((card) => card.id === "publisher")!.schedule).toBe("Background runner runs every 5 min");
  });

  it("explains a failed scan in words and never prints the raw exit code in the issue", () => {
    const input = inputs();
    input.tasks.ingest = { state: "ready", nextRunAt: null, lastRunAt: now.toISOString(), lastResult: 1, schedule: "PT1H" };
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "ingest")!;
    expect(card.issues.join(" ")).toContain("ended with an error");
    expect(card.issues.join(" ")).not.toMatch(/code \d/);
    input.tasks.ingest = { ...input.tasks.ingest, lastResult: 267011 };
    expect(buildAutomationOverview(input, now).cards.find((entry) => entry.id === "ingest")!.issues).toEqual([]);
  });

  it("lists what YouTube, Facebook and Buffer already hold, soonest first, with Studio links", () => {
    const input = inputs();
    const youtube = testItem({ id: "yt", title: "Held on YouTube", platformIds: ["youtube"], publishAt: "2026-10-03T15:00:00Z" });
    youtube.platforms.youtube = { status: "scheduled", attempts: 1, postId: "abc123" };
    const facebook = testItem({ id: "fb", title: "Held on Facebook", platformIds: ["facebook"], publishAt: "2026-10-02T15:00:00Z" });
    facebook.platforms.facebook = { status: "uploaded", attempts: 1 };
    const buffer = testItem({ id: "buf", title: "Held on Buffer", platformIds: [], publishAt: "2026-10-04T15:00:00Z", buffer: { status: "scheduled", attempts: 1 } });
    const waiting = testItem({ id: "wait", platformIds: ["youtube"] });
    input.queue = [youtube, facebook, buffer, waiting];
    const overview = buildAutomationOverview(input, now);
    expect(overview.heldTotal).toBe(3);
    expect(overview.held.map((post) => post.platform)).toEqual(["Facebook", "YouTube", "Buffer"]);
    expect(overview.held[1]).toMatchObject({ externalUrl: "https://studio.youtube.com/video/abc123/edit", href: "/uploading-center?item=yt&platform=youtube" });
  });

  it("moves a held post whose slot has passed out of 'still going live' into 'should be live'", () => {
    const input = inputs();
    const gone = testItem({ id: "gone", title: "Past its slot", platformIds: ["youtube"], publishAt: "2026-10-01T02:30:00Z" });
    gone.platforms.youtube = { status: "scheduled", attempts: 1, postId: "abc123" };
    const noId = testItem({ id: "noid", title: "Uploaded, no id", platformIds: ["facebook"], publishAt: "2026-10-01T03:00:00Z" });
    noId.platforms.facebook = { status: "uploaded", attempts: 1 };
    const grace = testItem({ id: "grace", title: "Just now", platformIds: ["youtube"], publishAt: "2026-10-01T14:55:00Z" });
    grace.platforms.youtube = { status: "scheduled", attempts: 1, postId: "def456" };
    const review = testItem({ id: "review", title: "Long-form held private", platformIds: ["youtube"], publishAt: "2026-10-01T02:00:00Z", format: "long" });
    review.platforms.youtube = { status: "scheduled", attempts: 1, postId: "ghi789" };
    const ahead = testItem({ id: "ahead", title: "Tomorrow", platformIds: ["youtube"], publishAt: "2026-10-02T15:00:00Z" });
    ahead.platforms.youtube = { status: "scheduled", attempts: 1, postId: "jkl012" };
    input.queue = [gone, noId, grace, review, ahead];
    const overview = buildAutomationOverview(input, now);
    expect(overview.shouldBeLive.map((post) => post.id)).toEqual(["gone:youtube", "noid:facebook"]);
    expect(overview.shouldBeLiveTotal).toBe(2);
    expect(overview.shouldBeLive[0].shouldBeLive).toMatchObject({ hint: "Its slot passed - YouTube should have published it by now.", linkLabel: "Check YouTube" });
    expect(overview.shouldBeLive[0].externalUrl).toBe("https://studio.youtube.com/video/abc123/edit");
    expect(overview.shouldBeLive[1].shouldBeLive).toMatchObject({ platform: "Facebook", linkLabel: "Check Facebook" });
    // Inside the grace window, held for review (never goes live by itself) and still ahead stay where they were.
    expect(overview.held.map((post) => post.id)).toEqual(["review:youtube", "grace:youtube", "ahead:youtube"]);
    expect(overview.heldTotal).toBe(3);
  });

  it("reports the cadence with the .env name of each value", () => {
    const rows = buildAutomationOverview(inputs(), now).cadence;
    const byEnv = Object.fromEntries(rows.map((row) => [row.env, row.value]));
    expect(byEnv.PUBLISH_SLOT_TIMES).toBe("07:30, 10:00, 12:30, 15:00, 17:30, 20:00");
    expect(byEnv.PUBLISH_SHORTS_PER_DAY).toBe("2");
    expect(byEnv.PUBLISH_TIMEZONE).toBe("America/Toronto");
    expect(rows.filter((row) => row.editable).map((row) => row.env).sort()).toEqual(["PUBLISH_SHORTS_PER_DAY", "PUBLISH_SLOT_TIMES", "PUBLISH_WEEKEND_SLOT_TIMES", "THREADS_POSTS_PER_DAY"]);
    expect(buildAutomationOverview(inputs(), now).cadenceValues).toMatchObject({ shortsPerDay: 2, threadsPostsPerDay: 24 });
    expect(byEnv.THREADS_POSTS_PER_DAY).toBe("24");
    expect(byEnv["THREADS_DAY_START / THREADS_DAY_END"]).toBe("00:20 to 23:20");
  });

  it("points the publisher card at its failed post, else its next due post", () => {
    const input = inputs();
    const due = testItem({ id: "due", platformIds: ["youtube"], publishAt: "2026-10-02T15:00:00Z" });
    const later = testItem({ id: "later", platformIds: ["youtube"], publishAt: "2026-10-05T15:00:00Z" });
    input.queue = [later, due];
    expect(buildAutomationOverview(input, now).cards.find((card) => card.id === "publisher")!.itemHref).toBe("/uploading-center?item=due&platform=youtube");
    later.platforms.youtube = { status: "failed", attempts: 3, error: "Quota" };
    expect(buildAutomationOverview(input, now).cards.find((card) => card.id === "publisher")!.itemHref).toBe("/uploading-center?item=later&platform=youtube");
    input.queue = [];
    expect(buildAutomationOverview(input, now).cards.find((card) => card.id === "publisher")!.itemHref).toBeUndefined();
  });
});
