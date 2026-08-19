import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";

/**
 * Mocked integration test for the ingest channel reader: the three Data API
 * reads, the mapping of duration / live-stream / frame-shape, the lookback
 * window, and the missing-readonly-scope (403 → reconnect) path. No live calls.
 */

const NOW = new Date("2026-07-26T12:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-client-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadModule() {
  return await import("@/lib/ingest/channelScan");
}

function routes(videos: unknown[]) {
  return mockFetchRoutes([
    { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
    {
      match: "youtube/v3/channels",
      respond: () =>
        jsonResponse({ items: [{ id: "UCabc", contentDetails: { relatedPlaylists: { uploads: "UUabc" } } }] })
    },
    {
      match: "youtube/v3/playlistItems",
      respond: () =>
        jsonResponse({
          items: (videos as Array<{ id: string }>).map((video) => ({ contentDetails: { videoId: video.id } }))
        })
    },
    { match: "youtube/v3/videos", respond: () => jsonResponse({ items: videos }) }
  ]);
}

const stream = {
  id: "live-1",
  snippet: { title: "Sunday stream", publishedAt: "2026-07-25T20:00:00Z" },
  status: { privacyStatus: "public" },
  contentDetails: { duration: "PT2H14M" },
  liveStreamingDetails: { actualStartTime: "2026-07-25T18:00:00Z", actualEndTime: "2026-07-25T20:14:00Z" },
  player: { embedHtml: '<iframe width="480" height="270" src="..."></iframe>' }
};

const short = {
  id: "short-1",
  snippet: { title: "Clip from the stream", publishedAt: "2026-07-26T09:00:00Z" },
  status: { privacyStatus: "public" },
  contentDetails: { duration: "PT48S" },
  player: { embedHtml: '<iframe width="480" height="853" src="..."></iframe>' }
};

const carVideo = {
  id: "car-1",
  snippet: { title: "Yapping in the car", publishedAt: "2026-07-26T08:00:00Z" },
  status: { privacyStatus: "public" },
  contentDetails: { duration: "PT11M4S" },
  player: { embedWidth: 480, embedHeight: 270 }
};

describe("scanChannelUploads", () => {
  it("reads duration, live-stream and frame shape for each upload", async () => {
    routes([stream, short, carVideo]);
    const { scanChannelUploads } = await loadModule();
    const scan = await scanChannelUploads({ now: NOW });

    expect(scan.configured).toBe(true);
    expect(scan.needsReconnect).toBe(false);
    expect(scan.channelId).toBe("UCabc");
    // Oldest first, so a backlog enters the pipeline in publish order.
    expect(scan.uploads.map((upload) => upload.videoId)).toEqual(["live-1", "car-1", "short-1"]);

    const live = scan.uploads.find((upload) => upload.videoId === "live-1")!;
    expect(live.wasLiveStream).toBe(true);
    expect(live.durationSec).toBe(8040);
    expect(live.aspect).toEqual({ width: 480, height: 270 });

    const vertical = scan.uploads.find((upload) => upload.videoId === "short-1")!;
    expect(vertical.wasLiveStream).toBe(false);
    expect(vertical.durationSec).toBe(48);
    expect(vertical.aspect).toEqual({ width: 480, height: 853 });

    // embedWidth/embedHeight are used directly when YouTube supplies them.
    const car = scan.uploads.find((upload) => upload.videoId === "car-1")!;
    expect(car.aspect).toEqual({ width: 480, height: 270 });
    expect(car.durationSec).toBe(664);
  });

  it("asks for the parts the decision needs, and for a sized player", async () => {
    const requests = routes([carVideo]);
    const { scanChannelUploads } = await loadModule();
    await scanChannelUploads({ now: NOW });

    const videosUrl = requests.map((request) => request.url).find((url) => url.includes("youtube/v3/videos"))!;
    expect(videosUrl).toContain("contentDetails");
    expect(videosUrl).toContain("liveStreamingDetails");
    expect(videosUrl).toContain("player");
    // Without maxWidth, YouTube returns no computed height and the aspect check
    // silently degrades to unknown for every video.
    expect(videosUrl).toContain("maxWidth=480");
  });

  it("drops uploads older than the lookback window", async () => {
    const old = { ...carVideo, id: "old-1", snippet: { title: "Last month", publishedAt: "2026-06-01T08:00:00Z" } };
    routes([carVideo, old]);
    const { scanChannelUploads } = await loadModule();
    const scan = await scanChannelUploads({ now: NOW, lookbackDays: 7 });
    expect(scan.uploads.map((upload) => upload.videoId)).toEqual(["car-1"]);
  });

  it("reports needsReconnect when the token lacks the readonly scope", async () => {
    mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
      {
        match: "youtube/v3/channels",
        respond: () => jsonResponse({ error: { message: "denied" } }, { status: 403 })
      }
    ]);
    const { scanChannelUploads } = await loadModule();
    const scan = await scanChannelUploads({ now: NOW });
    expect(scan).toMatchObject({ configured: true, needsReconnect: true, uploads: [] });
  });

  it("reports unconfigured rather than throwing when YouTube is not connected", async () => {
    vi.stubEnv("YOUTUBE_CLIENT_ID", "");
    vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "");
    vi.resetModules();
    const { scanChannelUploads } = await loadModule();
    const scan = await scanChannelUploads({ now: NOW });
    expect(scan).toEqual({ configured: false, needsReconnect: false, channelId: null, uploads: [] });
  });
});

describe("aspectFromPlayer", () => {
  it("prefers the numeric fields, falls back to parsing the embed", async () => {
    const { aspectFromPlayer } = await loadModule();
    expect(aspectFromPlayer({ embedWidth: 480, embedHeight: 853 })).toEqual({ width: 480, height: 853 });
    expect(aspectFromPlayer({ embedHtml: '<iframe width="480" height="270"></iframe>' })).toEqual({
      width: 480,
      height: 270
    });
  });

  // Returning null (unknown) rather than a wrong shape is what lets the decision
  // layer hold a video back for review instead of mis-classifying it.
  it("returns null when the shape cannot be read", async () => {
    const { aspectFromPlayer } = await loadModule();
    expect(aspectFromPlayer(undefined)).toBeNull();
    expect(aspectFromPlayer({})).toBeNull();
    expect(aspectFromPlayer({ embedHtml: "<iframe></iframe>" })).toBeNull();
    expect(aspectFromPlayer({ embedHtml: '<iframe width="0" height="0"></iframe>' })).toBeNull();
  });
});

describe("isLiveNow", () => {
  it("reads the broadcast field when YouTube gives one", async () => {
    const { isLiveNow } = await loadModule();
    expect(isLiveNow({ id: "v", snippet: { liveBroadcastContent: "live" } })).toBe(true);
    expect(isLiveNow({ id: "v", snippet: { liveBroadcastContent: "upcoming" } })).toBe(true);
    expect(isLiveNow({ id: "v", snippet: { liveBroadcastContent: "none" } })).toBe(false);
  });

  // The fallback that matters: a stream that started and has not ended is still
  // writing its VOD, so there is nothing whole to download yet.
  it("treats a started stream with no end time as still running", async () => {
    const { isLiveNow } = await loadModule();
    expect(isLiveNow({ id: "v", liveStreamingDetails: { actualStartTime: "2026-08-18T22:00:00Z" } })).toBe(true);
    expect(
      isLiveNow({
        id: "v",
        liveStreamingDetails: { actualStartTime: "2026-08-18T22:00:00Z", actualEndTime: "2026-08-19T01:00:00Z" }
      })
    ).toBe(false);
  });

  it("is false for an ordinary upload", async () => {
    const { isLiveNow } = await loadModule();
    expect(isLiveNow({ id: "v" })).toBe(false);
  });
});
