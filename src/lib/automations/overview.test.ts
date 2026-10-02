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
      { ...original, id: "reply-delivered", postId: "parent-2", plugPostId: "reply-2" }
    ];
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "threads")!;
    expect(card.counts.find((count) => count.label === "Published")?.value).toBe(2);
    expect(card.counts.find((count) => count.label === "Replies published")?.value).toBe(1);
    expect(card.counts.find((count) => count.label === "Replies waiting")?.value).toBe(1);
    expect(card.nextItemAt).toBe("2026-10-01T15:05:00.000Z");
    input.threads.plugReplies = false;
    const disabled = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "threads")!;
    expect(disabled.counts.find((count) => count.label === "Replies waiting")?.value).toBe(0);
    expect(disabled.counts.find((count) => count.label === "Replies published")?.value).toBe(1);
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
    expect(card.issues.join(" ")).toContain("No publisher tick recorded in over 15 minutes");
  });
});
