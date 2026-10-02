import { mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { readAutomationHistory } from "@/lib/automations/history";
import { runDue as publishDue } from "@/lib/publisher/runner";
import { runDue as threadsDue } from "@/lib/threads/runner";
import { PublishQueue } from "@/lib/publisher/queue";
import { TransientError } from "@/lib/publisher/http";
import { MemoryQueueStore, jsonResponse, mockFetchRoutes, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformAdapter } from "@/lib/publisher/types";
import { threadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import { DEFAULT_SHOW, mutatePodcastState } from "@/lib/podcast/store";
import { managePodcastDelivery, processDuePodcastDeliveries, scheduleEpisode } from "@/lib/podcast/schedule";

const podcast = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@/lib/podcast/publish", () => ({ podcastConfigured: () => true, publishEpisode: podcast.publish }));
const now = new Date("2026-10-08T14:00:00.000Z");
const later = new Date("2026-10-08T14:06:00.000Z");
let clipPath: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await rm(dataPath("automations"), { recursive: true, force: true });
  await rm(dataPath("podcast"), { recursive: true, force: true });
  await mkdir(dataPath("history-test"), { recursive: true });
  clipPath = dataPath("history-test", "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(32));
  podcast.publish.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function adapter(publish: PlatformAdapter["publish"]): PlatformAdapter {
  return { id: "youtube", configured: () => true, validateAuth: async () => undefined, buildPlan: () => ({ platform: "youtube", endpoint: "https://example.test", payload: {}, publishAtLocal: "local", publishAtUtc: now.toISOString(), notes: [] }), publish };
}

async function queue() {
  const config = testConfig({ platforms: ["youtube"] });
  const store = new PublishQueue(new MemoryQueueStore(), config);
  await store.add(testItem({ clipPath, publishAt: now.toISOString(), platformIds: ["youtube"] }));
  return { config, queue: store, log: () => undefined };
}

describe("delivery history from actual workers", () => {
  it("records publisher retry timing and one confirmed success without reposting", async () => {
    const options = await queue();
    const publish = vi.fn().mockRejectedValueOnce(new TransientError("temporary outage")).mockResolvedValue({ status: "published", postId: "posted" });
    await publishDue(now, { ...options, adapters: { youtube: adapter(publish) } });
    const first = await readAutomationHistory({ automationId: "publisher" });
    expect(first.counts).toMatchObject({ retrying: 1, delivered: 0 });
    expect(first.events.find((event) => event.kind === "retrying")?.nextAttemptAt).toBe("2026-10-08T14:02:00.000Z");
    vi.setSystemTime(later);
    await publishDue(later, { ...options, adapters: { youtube: adapter(publish) } });
    await publishDue(later, { ...options, adapters: { youtube: adapter(publish) } });
    expect(publish).toHaveBeenCalledTimes(2);
    expect((await readAutomationHistory({ automationId: "publisher" })).counts).toMatchObject({ delivered: 1, retrying: 1, failed: 0 });
  });

  it("does not record dry-run plans as deliveries or worker events", async () => {
    const options = await queue();
    const publish = vi.fn();
    await publishDue(now, { ...options, dryRun: true, adapters: { youtube: adapter(publish) } });
    expect(publish).not.toHaveBeenCalled();
    expect((await readAutomationHistory()).total).toBe(0);
  });

  it("keeps Buffer acceptance separate from confirmed publication", async () => {
    const options = await queue();
    const config = testConfig({ platforms: [], buffer: { enabled: true, accessToken: "test", profileIds: ["test"], apiBase: "https://example.test", shortenLinks: false } });
    const store = new PublishQueue(new MemoryQueueStore(), config);
    await store.add(testItem({ clipPath, publishAt: later.toISOString(), platformIds: [] }));
    mockFetchRoutes([{ match: "/updates/create.json", respond: () => jsonResponse({ success: true, updates: [{ id: "update" }] }) }, { match: "/updates/update.json", respond: () => jsonResponse({ status: "sent" }) }]);
    await publishDue(now, { ...options, config, queue: store });
    expect((await readAutomationHistory()).counts).toMatchObject({ scheduled: 1, delivered: 0 });
    vi.setSystemTime(later);
    await publishDue(later, { ...options, config, queue: store });
    expect((await readAutomationHistory()).counts).toMatchObject({ scheduled: 1, delivered: 1 });
  });

  it("retains Threads retry evidence after the queue succeeds", async () => {
    const config = { ...threadsConfig(), accounts: [{ id: "primary", label: "Test", userId: "user", accessToken: "test", posts: "text" as const, offsetMinutes: 0 }] };
    let items: ThreadsQueueItem[] = [{ id: "thread", batchDate: "2026-10-08", slot: 1, accountId: "primary", version: "text", topic: "A stream", format: "insight", text: "A real post", publishAt: now.toISOString(), status: "pending", attempts: 0, createdAt: now.toISOString() }];
    const post = vi.fn().mockRejectedValueOnce(new TransientError("temporary Threads outage")).mockResolvedValue({ postId: "posted", containerId: "container" });
    const deps = { read: async () => items, write: async (value: ThreadsQueueItem[]) => { items = value; }, post };
    await threadsDue(now, { config, deps, log: () => undefined });
    vi.setSystemTime(later);
    await threadsDue(later, { config, deps, log: () => undefined });
    expect(items[0].status).toBe("published");
    expect((await readAutomationHistory({ automationId: "threads" })).counts).toMatchObject({ delivered: 1, retrying: 1 });
  });

  it("records podcast retries and feed handoff without claiming Spotify ingestion", async () => {
    await mutatePodcastState((state) => { state.show = { ...DEFAULT_SHOW, email: "owner@example.test", artworkUrl: "https://cdn.example.test/art.png" }; state.episodes = []; state.deliveries = []; state.automation.enabled = true; });
    await scheduleEpisode({ title: "Real podcast", description: "Notes", filePath: clipPath, durationSec: 10, exportId: "export" }, now.toISOString(), new Date(now.getTime() - 60_000));
    podcast.publish.mockRejectedValueOnce(new Error("temporary feed outage")).mockResolvedValue({ episode: { id: "episode" } });
    await processDuePodcastDeliveries(now);
    expect((await readAutomationHistory({ automationId: "podcast" })).counts).toMatchObject({ retrying: 1, delivered: 0 });
    vi.setSystemTime(later);
    await processDuePodcastDeliveries(later);
    const history = await readAutomationHistory({ automationId: "podcast" });
    expect(history.counts).toMatchObject({ retrying: 1, delivered: 1 });
    expect(history.events.find((event) => event.kind === "delivered")).toMatchObject({ destination: "RSS feed", detail: expect.stringContaining("Spotify ingestion is not confirmed") });
  });

  it("lets a confirmed post finish even if the history folder is unwritable", async () => {
    const options = await queue();
    await mkdir(dataPath("automations"), { recursive: true });
    await writeFile(dataPath("automations", "history"), "not a directory");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const publish = vi.fn(async () => ({ status: "published" as const, postId: "posted" }));
    const report = await publishDue(now, { ...options, adapters: { youtube: adapter(publish) } });
    expect(report.outcomes[0].outcome).toBe("published");
    expect((await options.queue.list())[0].platforms.youtube?.status).toBe("published");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("History could not be saved"));
  });

  it("retains separate retry attempts after a manual reset of the podcast attempt counter", async () => {
    await mutatePodcastState((state) => { state.show = { ...DEFAULT_SHOW, email: "owner@example.test", artworkUrl: "https://cdn.example.test/art.png" }; state.episodes = []; state.deliveries = []; state.automation.enabled = true; });
    const delivery = await scheduleEpisode({ title: "Real podcast", description: "Notes", filePath: clipPath, durationSec: 10, exportId: "export" }, now.toISOString(), new Date(now.getTime() - 60_000));
    podcast.publish.mockRejectedValue(new Error("feed temporarily unavailable"));
    await processDuePodcastDeliveries(now);
    vi.setSystemTime(later);
    await managePodcastDelivery(delivery.id, "retry");
    await processDuePodcastDeliveries(later);
    expect((await readAutomationHistory({ automationId: "podcast" })).counts.retrying).toBe(2);
  });

  it("records the interrupted final podcast attempt as failed without uploading again", async () => {
    await mutatePodcastState((state) => { state.automation.enabled = true; state.deliveries = [{ id: "interrupted", title: "Interrupted release", description: "Notes", durationSec: 10, filePath: clipPath, exportId: "export", publishAt: "2026-10-08T12:00:00.000Z", createdAt: "2026-10-08T11:00:00.000Z", status: "publishing", attempts: 5, lastAttemptAt: "2026-10-08T13:00:00.000Z" }]; });
    await processDuePodcastDeliveries(now);
    expect(podcast.publish).not.toHaveBeenCalled();
    const history = await readAutomationHistory({ automationId: "podcast" });
    expect(history.counts.failed).toBe(1);
    expect(history.events[0].detail).toContain("interrupted");
  });
});
