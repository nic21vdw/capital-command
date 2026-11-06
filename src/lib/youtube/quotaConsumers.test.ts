import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncInbox } from "@/lib/inbox/sync";
import { sendReply } from "@/lib/inbox/send";
import { updateInbox } from "@/lib/inbox/store";
import { jsonResponse, sampleItem, samplePost } from "@/lib/inbox/test-helpers";
import { emptyInbox } from "@/lib/inbox/types";
import { storeLedger } from "@/lib/listening/ledger";
import { collectScan } from "@/lib/listening/scan";
import { scanChannelUploads } from "@/lib/ingest/channelScan";
import { youtubeAdapter, holdYoutubeVideoPrivate, updateYoutubeVideoPublishAt, updateYoutubeVideoTitle } from "@/lib/publisher/adapters/youtube";
import { youtubeChannelSchedule } from "@/lib/publisher/channelVideos";
import { youtubeChannelInfo } from "@/lib/publisher/googleAuth";
import { liveStatsDeps, resolveYoutubeStats } from "@/lib/publisher/youtubeStats";
import { testItem } from "@/lib/publisher/test-helpers";
import { readBackVideo, uploadCaptions, uploadStoryVideo } from "@/lib/story/youtube";
import { OutlierApiError, resolveChannel, runOutlierScan } from "@/lib/youtube/outlier-service";
import { writeOutlierStore } from "@/lib/youtube/outlier-store";
import { defaultOutlierStore } from "@/lib/youtube/outliers";
import { quotaLedgerFile, youtubeQuotaLedger, type DebitResult, type QuotaPurpose } from "@/lib/youtube/quotaLedger";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const FUTURE = "2027-01-15T18:30:00.000Z";
const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";
const NEVER_REFUSED: QuotaPurpose[] = ["upload", "inbox-reply"];

const events: string[] = [];
let verdict: "grant" | "refuse" = "grant";
let clipPath: string;

function respond(method: string, url: string): Response {
  const path = new URL(url).pathname;
  if (path.endsWith("/channels")) {
    return jsonResponse({ items: [{ id: CHANNEL_ID, snippet: { title: "CoLateral" }, contentDetails: { relatedPlaylists: { uploads: "UUup" } } }] });
  }
  if (path.endsWith("/playlistItems")) return jsonResponse({ items: [{ contentDetails: { videoId: "v1" } }] });
  if (path.endsWith("/commentThreads")) return jsonResponse({ items: [] });
  if (path.endsWith("/search")) return jsonResponse({ items: [] });
  if (path.endsWith("/comments")) return jsonResponse({ id: "reply-1" });
  if (path.includes("/upload/youtube/v3/videos")) return new Response("", { status: 200, headers: { location: "https://upload.example/session" } });
  if (path.endsWith("/videos") && method === "PUT") return jsonResponse({ id: "v1" });
  if (path.endsWith("/videos")) {
    return jsonResponse({
      items: [
        {
          id: "v1",
          snippet: { title: "A clip", publishedAt: "2026-10-12T00:00:00Z", description: "d", thumbnails: {} },
          status: { privacyStatus: "private", publishAt: FUTURE },
          statistics: { viewCount: "10", likeCount: "1", commentCount: "0" },
          contentDetails: { duration: "PT30S" }
        }
      ]
    });
  }
  return jsonResponse({}, 404);
}

function stubNetwork(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("oauth2.googleapis.com/tokeninfo")) return jsonResponse({ scope: "https://www.googleapis.com/auth/youtube.force-ssl" });
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "at-1", expires_in: 3600 });
      const parsed = new URL(url);
      events.push(`${method} ${parsed.hostname === "www.googleapis.com" ? parsed.pathname : parsed.hostname}`);
      if (parsed.hostname === "upload.example") return jsonResponse({ id: "v-up" });
      return respond(method, url);
    })
  );
}

function spyOnLedger(): void {
  vi.spyOn(youtubeQuotaLedger, "debit").mockImplementation(async (units: number, purpose: QuotaPurpose): Promise<DebitResult> => {
    events.push(`debit ${purpose} ${units}`);
    if (verdict === "refuse" && !NEVER_REFUSED.includes(purpose)) return { ok: false, reason: "budget", remaining: 0 };
    return { ok: true, remaining: 100 };
  });
}

const calls = () => events.filter((event) => !event.startsWith("debit"));
const debits = () => events.filter((event) => event.startsWith("debit"));

function expectEveryCallDebitedFirst(): void {
  expect(calls().length).toBeGreaterThan(0);
  events.forEach((event, index) => {
    if (!event.startsWith("debit")) expect(events[index - 1] ?? "", `${event} came without a debit before it`).toMatch(/^debit /);
  });
  expect(debits()).toHaveLength(calls().length);
}

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `quota-consumers-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(2048, 7));
});

beforeEach(async () => {
  events.length = 0;
  verdict = "grant";
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-client-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh-token");
  await rm(quotaLedgerFile(), { force: true });
  stubNetwork();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the inbox", () => {
  beforeEach(async () => {
    spyOnLedger();
    await updateInbox(() => emptyInbox());
  });

  it("debits one unit as 'inbox' before every comment page it reads", async () => {
    await syncInbox({ now: NOW, platforms: ["youtube"], posts: [samplePost({ postId: "v1" }), samplePost({ postId: "v2" })] });

    expect(debits()).toEqual(["debit inbox 1", "debit inbox 1"]);
    expect(calls()).toEqual(["GET /youtube/v3/commentThreads", "GET /youtube/v3/commentThreads"]);
    expectEveryCallDebitedFirst();
  });

  it("skips the read when the ledger turns it away, and says the quota is saved for uploads", async () => {
    verdict = "refuse";

    const report = await syncInbox({ now: NOW, platforms: ["youtube"], posts: [samplePost({ postId: "v1" })] });

    expect(calls()).toEqual([]);
    expect(debits()).toEqual(["debit inbox 1"]);
    expect(report.platforms.youtube?.status).toBe("deferred");
    expect(report.platforms.youtube?.detail).toMatch(/quota saved for uploads/i);
  });

  it("debits 50 units as 'inbox-reply' before it posts a reply", async () => {
    await updateInbox(() => ({ ...emptyInbox(), items: [sampleItem()] }));

    await sendReply("youtube:c1", "Thanks", { now: NOW, retryDelaysMs: [0, 0, 0] });

    expect(events).toEqual(["debit inbox-reply 50", "POST /youtube/v3/comments"]);
  });
});

describe("Listening", () => {
  const input = {
    groups: [{ id: "g", name: "G", intent: "competitor" as const, canLead: true, terms: ["ETABS", "SAP2000"] }],
    sources: { hn: false, reddit: false, youtube: true, bluesky: false, x: false }
  };
  const scan = () =>
    collectScan(input, { fetch: globalThis.fetch, now: () => NOW, youtubeAuth: async () => ({ key: "KEY" }), youtubeLedger: storeLedger(), youtubeDailyUnits: 1000 });

  beforeEach(spyOnLedger);

  it("debits 100 units as 'listening' before the search and one unit before each comment lookup", async () => {
    await scan();

    expect(debits()[0]).toBe("debit listening 100");
    expect(calls()[0]).toBe("GET /youtube/v3/search");
    expectEveryCallDebitedFirst();
  });

  it("sends nothing when the ledger turns the search away, and says the quota is saved for uploads", async () => {
    verdict = "refuse";

    const collected = await scan();

    expect(calls()).toEqual([]);
    expect(debits()).toEqual(["debit listening 100"]);
    expect(collected.sources[0].report).toMatchObject({ source: "youtube", skipped: true, ok: true });
    expect(collected.sources[0].report.note).toMatch(/quota saved for uploads/i);
  });
});

describe("uploads", () => {
  beforeEach(spyOnLedger);

  const publishInput = () => ({ item: testItem({ publishAt: FUTURE, platformIds: ["youtube"], visibility: "public" }), localPath: clipPath });

  it("debits 1,600 units as 'upload' before videos.insert", async () => {
    const result = await youtubeAdapter.publish(publishInput());

    expect(events).toEqual(["debit upload 1600", "POST /upload/youtube/v3/videos", "PUT upload.example"]);
    expect(result).toMatchObject({ status: "scheduled", postId: "v-up" });
  });

  it("spends nothing to resume a session that already holds the bytes", async () => {
    const item = testItem({ publishAt: FUTURE, platformIds: ["youtube"], visibility: "public" });
    item.platforms.youtube!.containerId = "https://upload.example/session";

    await youtubeAdapter.publish({ item, localPath: clipPath });

    expect(debits()).toEqual([]);
  });

  it("debits 1 unit for the status read and 50 for videos.update when it sets a late video public", async () => {
    const item = testItem({ publishAt: "2026-01-01T00:00:00.000Z", platformIds: ["youtube"], visibility: "public" });

    await youtubeAdapter.finalize!(item, { status: "scheduled", attempts: 0, postId: "v1" });

    expect(events).toEqual(["debit upload 1", "GET /youtube/v3/videos", "debit upload 50", "PUT /youtube/v3/videos"]);
  });

  it("debits the read and the update when it renames a video or moves its slot", async () => {
    await updateYoutubeVideoTitle("v1", "A better title");
    await updateYoutubeVideoPublishAt("v1", new Date("2099-02-01T15:00:00.000Z"));

    expect(events).toEqual([
      "debit upload 1",
      "GET /youtube/v3/videos",
      "debit upload 50",
      "PUT /youtube/v3/videos",
      "debit upload 1",
      "GET /youtube/v3/videos",
      "debit upload 50",
      "PUT /youtube/v3/videos"
    ]);
  });

  it("debits the read and the update when Remove holds a scheduled video private", async () => {
    expect(await holdYoutubeVideoPrivate("v1")).toBe("held");

    expect(events).toEqual(["debit upload 1", "GET /youtube/v3/videos", "debit upload 50", "PUT /youtube/v3/videos"]);
  });

  it("debits 1,600 for the story pipeline's insert, 400 for its captions and 1 for its read-back", async () => {
    const accessToken = async () => "at-1";
    const fetcher = (async (url: string) => {
      const target = String(url);
      if (target.includes("uploadType=resumable")) {
        events.push("POST resumable");
        return new Response("", { status: 200, headers: { location: "https://upload.example/session" } });
      }
      if (target.includes("/captions")) {
        events.push("POST captions");
        return jsonResponse({ id: "cap-1" });
      }
      if (target.includes("/videos?")) {
        events.push("GET videos");
        return jsonResponse({ items: [{ id: "v1", status: { privacyStatus: "private" }, snippet: { title: "t", description: "d" } }] });
      }
      events.push("PUT session");
      return jsonResponse({ id: "v1" });
    }) as typeof fetch;

    await uploadStoryVideo({
      file: clipPath,
      title: "[DRAFT] t",
      description: "d",
      tags: ["a"],
      categoryId: "28",
      language: "en",
      madeForKids: false,
      accessToken,
      fetcher,
      sleep: async () => undefined
    });
    await uploadCaptions({ videoId: "v1", srt: "1 00:00:00,000 --> 00:00:01,000 hi", language: "en", name: "English", accessToken, fetcher });
    await readBackVideo("v1", accessToken, fetcher);

    expect(events).toEqual([
      "debit upload 1600",
      "POST resumable",
      "PUT session",
      "debit upload 400",
      "POST captions",
      "debit upload 1",
      "GET videos"
    ]);
  });
});

describe("uploads when the ledger cannot or will not say yes", () => {
  it("go out exactly as they would on a good ledger when the file is damaged, which is left alone", async () => {
    await mkdir(path.dirname(quotaLedgerFile()), { recursive: true });
    await writeFile(quotaLedgerFile(), "{ not json");
    const item = testItem({ publishAt: FUTURE, platformIds: ["youtube"], visibility: "public" });

    const result = await youtubeAdapter.publish({ item, localPath: clipPath });
    await updateYoutubeVideoTitle("v1", "A better title");
    await youtubeAdapter.finalize!(testItem({ publishAt: "2026-01-01T00:00:00.000Z", platformIds: ["youtube"], visibility: "public" }), {
      status: "scheduled",
      attempts: 0,
      postId: "v1"
    });

    expect(result).toMatchObject({ status: "scheduled", postId: "v-up" });
    expect(events).toEqual([
      "POST /upload/youtube/v3/videos",
      "PUT upload.example",
      "GET /youtube/v3/videos",
      "PUT /youtube/v3/videos",
      "GET /youtube/v3/videos",
      "PUT /youtube/v3/videos"
    ]);
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(quotaLedgerFile(), "utf8")).toBe("{ not json");
  });

  it("go out on a day the ledger already shows as spent, and are still recorded", async () => {
    await youtubeQuotaLedger.debit(9_900, "upload");
    const item = testItem({ publishAt: FUTURE, platformIds: ["youtube"], visibility: "public" });

    const result = await youtubeAdapter.publish({ item, localPath: clipPath });

    expect(result).toMatchObject({ status: "scheduled", postId: "v-up" });
    expect((await youtubeQuotaLedger.snapshot()).byPurpose.upload).toBe(11_500);
  });
});

describe("the outlier scan", () => {
  beforeEach(spyOnLedger);

  it("debits one unit as 'outliers' before resolving a channel", async () => {
    await resolveChannel(CHANNEL_ID);

    expect(events).toEqual(["debit outliers 1", "GET /youtube/v3/channels"]);
  });

  it("refuses to resolve a channel when the ledger says no, with a message that names why", async () => {
    verdict = "refuse";

    const failure = await resolveChannel(CHANNEL_ID).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OutlierApiError);
    expect((failure as OutlierApiError).message).toMatch(/quota saved for uploads/i);
    expect(calls()).toEqual([]);
  });

  async function seedChannel() {
    await writeOutlierStore({
      ...defaultOutlierStore,
      channels: [
        {
          id: CHANNEL_ID,
          title: "Rival",
          handle: null,
          thumbnailUrl: null,
          uploadsPlaylistId: "UUrival",
          addedAt: "2026-10-01T00:00:00.000Z",
          lastFetchedAt: null,
          lastError: null,
          baseline: null,
          recentVideos: [],
          group: ""
        }
      ]
    });
  }

  it("debits before the playlist read and again before the stats read of each channel", async () => {
    await seedChannel();

    const { run } = await runOutlierScan({ force: true });

    expect(events).toEqual(["debit outliers 1", "GET /youtube/v3/playlistItems", "debit outliers 1", "GET /youtube/v3/videos"]);
    expect(run.unitsUsed).toBe(2);
  });

  it("stops without a call when the ledger turns the scan away, and does not blame the channel", async () => {
    await seedChannel();
    verdict = "refuse";

    const { store, run } = await runOutlierScan({ force: true });

    expect(calls()).toEqual([]);
    expect(run).toMatchObject({ unitsUsed: 0, channelsChecked: 0, channelsFailed: 0 });
    expect(run.notes.join(" ")).toMatch(/quota saved for uploads/i);
    expect(store.channels[0].lastError).toBeNull();
  });
});

describe("video statistics", () => {
  beforeEach(spyOnLedger);

  it("debits one unit as 'stats' before each videos.list", async () => {
    await liveStatsDeps.fetchStatistics("youtube-primary", ["v1"]);

    expect(events).toEqual(["debit stats 1", "GET /youtube/v3/videos"]);
  });

  it("keeps the last numbers and says the quota is saved for uploads when the ledger turns it away", async () => {
    verdict = "refuse";
    const failures = new Map<string, number>();

    const answer = await resolveYoutubeStats([{ videoId: "v1", accountId: "youtube-primary" }], {
      ...liveStatsDeps,
      now: () => NOW,
      readCache: async () => ({ v1: { views: 5, likes: 1, comments: 0, fetchedAt: "2026-10-12T00:00:00.000Z" } }),
      writeCache: async () => undefined,
      failures
    });

    expect(calls()).toEqual([]);
    expect(answer.status).toBe("stale");
    expect(answer.message).toMatch(/quota saved for uploads/i);
    expect(answer.stats.v1.views).toBe(5);
    expect(failures.size).toBe(0);
  });
});

describe("the channel schedule", () => {
  beforeEach(spyOnLedger);

  it("debits one unit as 'schedule' before each of its three reads", async () => {
    await youtubeChannelSchedule({ force: true, now: NOW });

    expect(events).toEqual([
      "debit schedule 1",
      "GET /youtube/v3/channels",
      "debit schedule 1",
      "GET /youtube/v3/playlistItems",
      "debit schedule 1",
      "GET /youtube/v3/videos"
    ]);
  });

  it("makes no call and shows the quota is saved for uploads when the ledger turns it away", async () => {
    verdict = "refuse";

    const schedule = await youtubeChannelSchedule({ force: true, now: NOW });

    expect(calls()).toEqual([]);
    expect(schedule.error).toMatch(/quota saved for uploads/i);
    expect(schedule.needsReconnect).toBe(false);
  });
});

describe("the daily channel scan", () => {
  beforeEach(spyOnLedger);

  it("debits one unit as 'ingest' before each of its three reads", async () => {
    await scanChannelUploads({ now: NOW });

    expect(debits()).toEqual(["debit ingest 1", "debit ingest 1", "debit ingest 1"]);
    expectEveryCallDebitedFirst();
  });

  it("makes no call when the ledger turns it away", async () => {
    verdict = "refuse";

    await expect(scanChannelUploads({ now: NOW })).rejects.toThrow(/quota saved for uploads/i);
    expect(calls()).toEqual([]);
  });
});

describe("the connected channel's name", () => {
  beforeEach(spyOnLedger);

  it("debits one unit as 'channel' before the lookup, and tries again later when it was turned away", async () => {
    verdict = "refuse";
    expect(await youtubeChannelInfo("youtube-primary")).toBeNull();
    expect(calls()).toEqual([]);

    verdict = "grant";
    const info = await youtubeChannelInfo("youtube-primary");

    expect(info).toMatchObject({ title: "CoLateral" });
    expect(events).toEqual(["debit channel 1", "debit channel 1", "GET /youtube/v3/channels"]);
  });
});
