import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";

/**
 * Mocked integration test for the channel-schedule reader: asserts the three
 * Data API reads (channels → uploads playlist → video details), the mapping
 * of YouTube's scheduled/published states, the 5-minute cache, and the
 * missing-readonly-scope (403 → reconnect) path. No live calls.
 */

const NOW = new Date("2026-07-05T12:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-client-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh-token");
  // Fresh module per test so the in-module cache never leaks between tests.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadModule() {
  return await import("@/lib/publisher/channelVideos");
}

function happyRoutes() {
  return mockFetchRoutes([
    { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
    {
      match: "youtube/v3/channels",
      respond: () => jsonResponse({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUabc" } } }] })
    },
    {
      match: "youtube/v3/playlistItems",
      respond: () =>
        jsonResponse({
          items: [
            { contentDetails: { videoId: "sched-1" } },
            { contentDetails: { videoId: "pub-1" } },
            { contentDetails: { videoId: "old-pub" } },
            { contentDetails: { videoId: "draft-1" } }
          ]
        })
    },
    {
      match: "youtube/v3/videos",
      respond: () =>
        jsonResponse({
          items: [
            {
              id: "sched-1",
              snippet: { title: "Scheduled short", thumbnails: { medium: { url: "https://img/sched-1.jpg" } } },
              status: { privacyStatus: "private", publishAt: "2026-07-06T11:30:00Z" }
            },
            {
              id: "pub-1",
              snippet: { title: "Fresh upload", publishedAt: "2026-07-04T16:30:00Z", thumbnails: {} },
              status: { privacyStatus: "public" }
            },
            {
              id: "old-pub",
              snippet: { title: "Ancient upload", publishedAt: "2026-01-01T00:00:00Z" },
              status: { privacyStatus: "public" }
            },
            {
              id: "draft-1",
              snippet: { title: "Plain private draft" },
              status: { privacyStatus: "private" }
            }
          ]
        })
    }
  ]);
}

describe("youtubeChannelSchedule", () => {
  it("reads channel → uploads playlist → details and maps scheduled/published videos", async () => {
    const requests = happyRoutes();
    const { youtubeChannelSchedule } = await loadModule();

    const schedule = await youtubeChannelSchedule({ now: NOW });

    // The three reads, all authorized GETs.
    expect(requests[1].url).toContain("youtube/v3/channels?part=contentDetails&mine=true");
    expect(requests[2].url).toContain("playlistId=UUabc");
    expect(requests[3].url).toContain("id=sched-1,pub-1,old-pub,draft-1");
    for (const request of requests.slice(1)) {
      expect(request.method).toBe("GET");
      expect(request.headers.Authorization).toBe("Bearer at-1");
    }

    expect(schedule.configured).toBe(true);
    expect(schedule.needsReconnect).toBe(false);
    expect(schedule.error).toBeNull();
    expect(schedule.fetchedAt).toBe(NOW.toISOString());
    // Old published videos and plain private drafts are excluded; the rest is
    // sorted by time (published yesterday before tomorrow's scheduled one).
    expect(schedule.videos).toEqual([
      {
        videoId: "pub-1",
        title: "Fresh upload",
        status: "published",
        publishAtUtc: "2026-07-04T16:30:00.000Z",
        thumbnailUrl: null,
        url: "https://www.youtube.com/watch?v=pub-1"
      },
      {
        videoId: "sched-1",
        title: "Scheduled short",
        status: "scheduled",
        publishAtUtc: "2026-07-06T11:30:00.000Z",
        thumbnailUrl: "https://img/sched-1.jpg",
        url: "https://www.youtube.com/watch?v=sched-1"
      }
    ]);
  });

  it("serves from cache within the TTL and refetches when forced", async () => {
    const requests = happyRoutes();
    const { youtubeChannelSchedule } = await loadModule();

    await youtubeChannelSchedule({ now: NOW });
    const fetchesAfterFirst = requests.length;

    const cached = await youtubeChannelSchedule({ now: new Date(NOW.getTime() + 60_000) });
    expect(requests.length).toBe(fetchesAfterFirst);
    expect(cached.videos).toHaveLength(2);

    await youtubeChannelSchedule({ now: new Date(NOW.getTime() + 60_000), force: true });
    expect(requests.length).toBeGreaterThan(fetchesAfterFirst);
  });

  it("flags needsReconnect when reads 403 (token predates the readonly scope)", async () => {
    mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
      {
        match: "youtube/v3/channels",
        respond: () => new Response(JSON.stringify({ error: { code: 403 } }), { status: 403 })
      }
    ]);
    const { youtubeChannelSchedule } = await loadModule();

    const schedule = await youtubeChannelSchedule({ now: NOW });

    expect(schedule.configured).toBe(true);
    expect(schedule.needsReconnect).toBe(true);
    expect(schedule.videos).toEqual([]);
    expect(schedule.error).toBeNull();
  });

  it("keeps the last good data and reports the error on a transient failure", async () => {
    const requests = happyRoutes();
    const { youtubeChannelSchedule } = await loadModule();
    await youtubeChannelSchedule({ now: NOW });

    // Past the TTL, the refetch blows up at the channels call.
    vi.unstubAllGlobals();
    mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-2", expires_in: 3600 }) },
      { match: "youtube/v3/channels", respond: () => new Response("boom", { status: 500 }) }
    ]);
    const later = new Date(NOW.getTime() + 6 * 60_000);

    const schedule = await youtubeChannelSchedule({ now: later });

    expect(schedule.videos).toHaveLength(2);
    expect(schedule.error).toContain("YouTube channel lookup failed");
    expect(schedule.fetchedAt).toBe(NOW.toISOString());
    expect(requests.length).toBe(4);
  });

  it("reports unconfigured without touching the network when credentials are missing", async () => {
    vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "");
    const requests = mockFetchRoutes([]);
    const { youtubeChannelSchedule } = await loadModule();

    const schedule = await youtubeChannelSchedule({ now: NOW });

    expect(schedule.configured).toBe(false);
    expect(schedule.videos).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
