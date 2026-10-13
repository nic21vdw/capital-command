import { describe, expect, it } from "vitest";
import { buildAutomationOverview, type AutomationInputs } from "@/lib/automations/overview";
import { orderWarnings, warningRank } from "@/lib/automations/warnings";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import { threadsConfig } from "@/lib/threads/config";

const now = new Date("2026-10-01T15:00:00Z");

describe("warning order on an automation card", () => {
  it("puts what can be fixed now before notes about this computer, keeping order inside each group", () => {
    const ordered = orderWarnings([
      "This page can't check the background runner, so it can't tell whether it is installed.",
      "Three agents one repo: TikTok connection expired - reconnect in Settings",
      "Some other note",
      "Another post: Instagram connection expired - reconnect in Settings"
    ]);
    expect(ordered).toEqual([
      "Three agents one repo: TikTok connection expired - reconnect in Settings",
      "Another post: Instagram connection expired - reconnect in Settings",
      "Some other note",
      "This page can't check the background runner, so it can't tell whether it is installed."
    ]);
  });

  it("ranks the real strings the cards produce", () => {
    expect(warningRank("The background runner belongs to a different copy of the app. This copy has no runner of its own.")).toBe(2);
    expect(warningRank("Runner not installed - run npm run publish:register in the app folder, then press Refresh.")).toBe(0);
    expect(warningRank("No Threads account is connected - add the access token in Settings > Accounts.")).toBe(0);
    expect(warningRank("Video and picture posting is switched off in Settings.")).toBe(0);
    expect(warningRank("The publisher has not run in over 15 minutes.")).toBe(1);
  });

  it("leads the publisher card with the expired TikTok connection even though the runner can't be read", () => {
    const input: AutomationInputs = {
      controls: {}, outcomes: {}, tasks: {}, runs: [], ledger: { lastScanAt: null, records: [] }, ingestRunning: false,
      queue: [testItem({ title: "Three agents one repo", platformIds: ["tiktok"] })], publisher: testConfig(), threads: threadsConfig(), threadsItems: [], threadsState: {},
      podcast: { automation: { enabled: true, time: "09:00", timeZone: "America/Toronto" }, deliveries: [], nextDueAt: null },
      podcastBlockers: [], spotifyConnected: false, spotifyShowLinked: false, episodes: 0, autoScheduleOvernight: false
    };
    input.queue[0].platforms.tiktok = { status: "failed", attempts: 1, error: "invalid_grant" };
    const card = buildAutomationOverview(input, now).cards.find((entry) => entry.id === "publisher")!;
    expect(card.blockers[0]).toContain("can't check the background runner");
    const [first] = orderWarnings([...card.blockers, ...card.issues]);
    expect(first).toContain("TikTok connection expired");
  });
});
