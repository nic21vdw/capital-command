import { describe, expect, it } from "vitest";
import { buildAutomationOverview, type AutomationInputs } from "@/lib/automations/overview";
import { testConfig } from "@/lib/publisher/test-helpers";
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
});
