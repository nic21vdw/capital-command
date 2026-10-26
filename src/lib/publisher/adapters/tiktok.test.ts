import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput, TiktokPostOptions } from "@/lib/publisher/types";

/**
 * Mocked integration test: asserts the outgoing requests match the TikTok
 * Content Posting API Direct Post contract (oauth/token refresh → video/init
 * with FILE_UPLOAD → chunk PUT → status/fetch). No live calls.
 */

// A connected machine has a real refresh token in data/publisher-tokens.json,
// and BOTH the adapter (via getCachedToken) and publisherConfig (which reads
// that file synchronously) prefer it over the .env seed. Pin the token to the
// env stub so the suite never reaches for the live one.
const tokenCache = new Map<string, string>();
let failTokenWrites = false;

vi.mock("@/lib/publisher/tokens", () => ({
  getCachedToken: async (key: string) => tokenCache.get(key) ?? null,
  setCachedToken: async (key: string, value: string) => {
    if (failTokenWrites) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    tokenCache.set(key, value);
  }
}));

const probe = vi.hoisted(() => ({
  durationSec: 30 as number | null,
  unreadable: false,
  hang: false,
  calls: 0,
  signal: undefined as AbortSignal | undefined
}));

vi.mock("@/lib/clipping/ffmpeg", () => ({
  probeVideoStream: vi.fn((_path: string, options?: { signal?: AbortSignal }) => {
    probe.calls += 1;
    probe.signal = options?.signal;
    if (probe.hang) {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("probe stopped")));
      });
    }
    if (probe.unreadable) return Promise.reject(new Error("not a video"));
    return Promise.resolve({ width: 1080, height: 1920, durationSec: probe.durationSec });
  })
}));

vi.mock("@/lib/publisher/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/config")>();
  return {
    ...actual,
    publisherConfig: () => {
      const config = actual.publisherConfig();
      return { ...config, tiktok: { ...config.tiktok, refreshToken: process.env.TIKTOK_REFRESH_TOKEN ?? null } };
    }
  };
});

const CLIP_BYTES = 4096;
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `publisher-tt-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(CLIP_BYTES, 3));
});

beforeEach(() => {
  probe.durationSec = 30;
  probe.unreadable = false;
  probe.hang = false;
  probe.signal = undefined;
  probe.calls = 0;
  tokenCache.clear();
  failTokenWrites = false;
  vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
  vi.stubEnv("TIKTOK_REFRESH_TOKEN", "tt-refresh");
  vi.stubEnv("UPLOAD_POST_API_KEY", "");
  vi.stubEnv("UPLOAD_POST_USER", "");
  vi.stubEnv("BUFFER_API_KEY", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadAdapter() {
  return (await import("@/lib/publisher/adapters/tiktok")).tiktokAdapter;
}

function input(overrides: Partial<PublishInput["item"]> = {}): PublishInput {
  return {
    item: testItem({ platformIds: ["tiktok"], caption: "Wild moment", hashtags: ["#clips"], ...overrides }),
    localPath: clipPath
  };
}

/** The same input, with the consent a creator gives in the panel. */
function direct(base: PublishInput, consent: Omit<TiktokPostOptions, "delivery">): PublishInput {
  return {
    ...base,
    item: { ...base.item, tiktok: { delivery: "direct", consentedAt: "2026-10-13T12:00:00.000Z", ...consent } }
  };
}

type CreatorInfoOverride = {
  data?: Record<string, unknown>;
  error?: { code: string; message?: string };
  status?: number;
};

function routes(
  finalStatus: "PUBLISH_COMPLETE" | "SEND_TO_USER_INBOX" = "SEND_TO_USER_INBOX",
  creatorInfo: CreatorInfoOverride = {},
  refreshToken = "tt-refresh"
) {
  const init = () =>
    jsonResponse({
      data: { publish_id: "pub-1", upload_url: "https://upload.tiktok.example/u1" },
      error: { code: "ok" }
    });
  return mockFetchRoutes([
    {
      // Refresh token grant returns the same refresh_token (no rotation).
      match: "/v2/oauth/token/",
      respond: () => jsonResponse({ access_token: "tt-at", expires_in: 86400, refresh_token: refreshToken })
    },
    {
      // Direct posts query this first. The account has Duet switched off, so a
      // consent claiming otherwise has something to be held against.
      match: "/v2/post/publish/creator_info/query/",
      respond: () =>
        jsonResponse({
          data: creatorInfo.data ?? {
            creator_nickname: "Nic",
            creator_username: "nicvandewetering",
            privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
            duet_disabled: true,
            max_video_post_duration_sec: 600
          },
          error: creatorInfo.error ?? { code: "ok" }
        }, { status: creatorInfo.status ?? 200 })
    },
    // Inbox first: its path also ends in /video/init/, so it has to be matched
    // before the Direct Post route or every inbox call lands on the wrong one.
    { match: "/v2/post/publish/inbox/video/init/", respond: init },
    { match: "/v2/post/publish/video/init/", respond: init },
    { match: "upload.tiktok.example/u1", respond: () => new Response(null, { status: 201 }) },
    {
      match: "/v2/post/publish/status/fetch/",
      respond: () =>
        jsonResponse({
          data:
            finalStatus === "PUBLISH_COMPLETE"
              ? { status: finalStatus, publicaly_available_post_id: [7345678901234567890] }
              : { status: finalStatus },
          error: { code: "ok" }
        })
    }
  ]);
}

describe("tiktok refresh-token rotation", () => {
  it("stores the rotated refresh token when TikTok hands one back", async () => {
    routes("SEND_TO_USER_INBOX", {}, "tt-refresh-rotated");
    await (await loadAdapter()).publish(input({ visibility: "public" }));
    expect(tokenCache.get("tiktok.refreshToken")).toBe("tt-refresh-rotated");
  });

  it("still posts with the new access token when the rotated one cannot be saved", async () => {
    failTokenWrites = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requests = routes("SEND_TO_USER_INBOX", {}, "tt-refresh-rotated");

    const result = await (await loadAdapter()).publish(input({ visibility: "public" }));

    expect(result.status).toBe("scheduled");
    const init = requests.find((request) => request.url.endsWith("/post/publish/inbox/video/init/"));
    expect(init?.headers.Authorization).toBe("Bearer tt-at");
    expect(tokenCache.has("tiktok.refreshToken")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rotated refresh token could not be saved"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EBUSY"));
    warn.mockRestore();
  });
});

describe("tiktok adapter", () => {
  it("sends to the creator's TikTok inbox while unaudited", async () => {
    const requests = routes();
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "public" }));

    // 1. OAuth refresh grant, form-encoded.
    const token = requests[0];
    expect(token.url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(formBody(token)).toEqual({
      client_key: "tt-key",
      client_secret: "tt-secret",
      grant_type: "refresh_token",
      refresh_token: "tt-refresh"
    });

    // 2. Inbox init: TikTok refuses Direct Post from an unaudited app to a
    //    public account, so the clip goes to the creator's inbox instead.
    //    post_info is omitted — the inbox flow rejects it.
    const init = requests[1];
    expect(init.url).toBe("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/");
    expect(init.headers.Authorization).toBe("Bearer tt-at");
    const body = JSON.parse(String(init.body));
    expect(body.post_info).toBeUndefined();
    expect(body.source_info).toEqual({
      source: "FILE_UPLOAD",
      video_size: CLIP_BYTES,
      chunk_size: CLIP_BYTES,
      total_chunk_count: 1
    });

    // 3. Binary chunk PUT with a Content-Range covering the whole file.
    const upload = requests[2];
    expect(upload.method).toBe("PUT");
    expect(upload.headers["Content-Range"]).toBe(`bytes 0-${CLIP_BYTES - 1}/${CLIP_BYTES}`);
    expect(upload.headers["Content-Type"]).toBe("video/mp4");

    // 4. SEND_TO_USER_INBOX is terminal — the last step is a tap in the TikTok
    //    app, so the runner must not keep polling for it.
    const status = requests[3];
    expect(JSON.parse(String(status.body))).toEqual({ publish_id: "pub-1" });

    expect(result.status).toBe("scheduled");
    expect(result.containerId).toBe("pub-1");
    expect(result.detail).toMatch(/inbox/i);
  });

  it("direct-posts with the configured visibility once TIKTOK_AUDITED=true", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const result = await adapter.publish(
      direct(input({ visibility: "public" }), { privacyLevel: "PUBLIC_TO_EVERYONE" })
    );

    const init = requests[2];
    expect(init.url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    const body = JSON.parse(String(init.body));
    expect(body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(body.post_info.title).toBe("Wild moment\n\n#clips");
    expect(result.status).toBe("published");
  });

  it("tells the creator the post can take a few minutes to show on their profile", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const result = await adapter.publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE" }));

    expect(result.detail).toMatch(/few minutes/i);
  });

  it("keeps a private item SELF_ONLY once audited", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    await adapter.publish(direct(input({ visibility: "private" }), { privacyLevel: "SELF_ONLY" }));

    expect(JSON.parse(String(requests[2].body)).post_info.privacy_level).toBe("SELF_ONLY");
  });

  it("asks TikTok what the creator allows before every direct post", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    await adapter.publish(
      direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: true, allowStitch: true })
    );

    expect(requests[1].url).toBe("https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
    const post = JSON.parse(String(requests[2].body)).post_info;
    expect(post.disable_comment).toBe(false);
    // The account has Duet switched off in TikTok, so a stored consent saying
    // otherwise is not what gets sent.
    expect(post.disable_duet).toBe(true);
    expect(post.disable_stitch).toBe(false);
  });

  it("sends every interaction the creator did not turn on as disabled", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    await adapter.publish(direct(input(), { privacyLevel: "SELF_ONLY" }));

    const post = JSON.parse(String(requests[2].body)).post_info;
    expect(post.disable_comment).toBe(true);
    expect(post.disable_duet).toBe(true);
    expect(post.disable_stitch).toBe(true);
    expect(post.brand_content_toggle).toBe(false);
    expect(post.brand_organic_toggle).toBe(false);
  });

  it("carries the commercial-content disclosure through to TikTok", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    await adapter.publish(
      direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE", brandOrganic: true, brandedContent: true })
    );

    const post = JSON.parse(String(requests[2].body)).post_info;
    expect(post.brand_organic_toggle).toBe(true);
    expect(post.brand_content_toggle).toBe(true);
  });

  it("refuses a wider-than-private direct post while the app is unaudited", async () => {
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const error = await adapter
      .publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE" }))
      .catch((thrown: unknown) => thrown);

    expect((error as Error).message).toMatch(/unaudited app to private posts/i);
    // Refused before a byte was uploaded.
    expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
  });

  it("sends nothing until the creator has explicitly agreed to the upload", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const unagreed = direct(input(), { privacyLevel: "SELF_ONLY" });
    delete unagreed.item.tiktok!.consentedAt;
    const error = await adapter.publish(unagreed).catch((thrown: unknown) => thrown);

    expect((error as Error).message).toMatch(/agree/i);
    expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
    expect(requests.some((request) => request.url.includes("upload.tiktok.example"))).toBe(false);
  });

  it("refuses a disclosure that was switched on without saying who is promoted", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const error = await adapter
      .publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE", disclosure: true }))
      .catch((thrown: unknown) => thrown);

    expect((error as Error).message).toMatch(/promotes yourself, a third party, or both/i);
    expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
  });

  it("holds the clip against the longest video the creator's account may post", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    probe.durationSec = 602;
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const error = await adapter
      .publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE" }))
      .catch((thrown: unknown) => thrown);

    expect((error as Error).message).toMatch(/602s long.*up to 600s/i);
    expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
  });

  it("posts a clip that is as long as the account allows, give or take a second", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    probe.durationSec = 601;
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const result = await adapter.publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE" }));

    expect(result.status).toBe("published");
    expect(requests.some((request) => request.url.endsWith("/post/publish/video/init/"))).toBe(true);
  });

  it("does not block a post on a duration it could not read, and says it skipped the check", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    probe.unreadable = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const result = await adapter.publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE" }));

    expect(result.status).toBe("published");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/clip.mp4.*skipping the duration check.*not a video/i));
    warn.mockRestore();
  });

  it("gives the duration probe ten seconds, then skips the check and says so", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    probe.hang = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = adapter.publish(direct(input(), { privacyLevel: "PUBLIC_TO_EVERYONE" }));
      for (let turn = 0; turn < 100 && probe.calls === 0; turn += 1) await vi.advanceTimersByTimeAsync(0);
      expect(probe.calls).toBe(1);
      expect(probe.signal).toBeInstanceOf(AbortSignal);
      expect(probe.signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(probe.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(probe.signal?.aborted).toBe(true);

      const result = await pending;
      expect(result.status).toBe("published");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipping the duration check/i));
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("waits and tries again when TikTok says the account has hit its daily post limit", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE", {
      data: {},
      error: { code: "spam_risk_too_many_posts", message: "daily cap" }
    });
    const adapter = await loadAdapter();
    const { ThrottledError } = await import("@/lib/publisher/http");

    const error = await adapter
      .publish(direct(input(), { privacyLevel: "SELF_ONLY" }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ThrottledError);
    expect((error as InstanceType<typeof ThrottledError>).retryAfterMinutes).toBe(720);
    expect((error as Error).message).toMatch(/posting limit for the day is spent.*12 hours/i);
    expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
  });

  it("waits an hour when the daily quota or the rate limit arrives as a 4xx", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const { ThrottledError } = await import("@/lib/publisher/http");
    for (const [status, code] of [
      [400, "reached_active_user_cap"],
      [429, "rate_limit_exceeded"]
    ] as const) {
      const requests = routes("PUBLISH_COMPLETE", { data: {}, error: { code, message: code }, status });
      const adapter = await loadAdapter();

      const error = await adapter
        .publish(direct(input(), { privacyLevel: "SELF_ONLY" }))
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ThrottledError);
      expect((error as InstanceType<typeof ThrottledError>).retryAfterMinutes).toBe(60);
      expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
    }
  });

  it("fails for good when the ban arrives as a 4xx", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    routes("PUBLISH_COMPLETE", {
      data: {},
      error: { code: "spam_risk_user_banned_from_posting", message: "banned" },
      status: 403
    });
    const adapter = await loadAdapter();
    const { PermanentError, ThrottledError } = await import("@/lib/publisher/http");

    const error = await adapter
      .publish(direct(input(), { privacyLevel: "SELF_ONLY" }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PermanentError);
    expect(error).not.toBeInstanceOf(ThrottledError);
  });

  it("keeps the inbox flow's finished status line exactly as it was", async () => {
    routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const result = await adapter.publish(input());

    expect(result.status).toBe("published");
    expect(result.detail).toBe("PUBLISH_COMPLETE");
  });

  it("fails for good when TikTok has banned the account from posting", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE", {
      data: {},
      error: { code: "spam_risk_user_banned_from_posting", message: "banned" }
    });
    const adapter = await loadAdapter();
    const { PermanentError } = await import("@/lib/publisher/http");

    const error = await adapter
      .publish(direct(input(), { privacyLevel: "SELF_ONLY" }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PermanentError);
    expect(requests.some((request) => request.url.includes("/video/init/"))).toBe(false);
  });

  it("leaves the inbox flow exactly as it was: no creator_info, no duration check, no consent needed", async () => {
    probe.durationSec = 99_999;
    const requests = routes();
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "public" }));

    expect(result.status).toBe("scheduled");
    expect(requests.some((request) => request.url.includes("creator_info"))).toBe(false);
    expect(requests.some((request) => request.url.endsWith("/post/publish/inbox/video/init/"))).toBe(true);
    expect(probe.calls).toBe(0);
  });

  it("defers instead of failing when TikTok's inbox backlog blocks the upload", async () => {
    mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () => jsonResponse({ access_token: "tt-at", expires_in: 86400, refresh_token: "tt-refresh" })
      },
      {
        match: "/v2/post/publish/inbox/video/init/",
        respond: () =>
          jsonResponse(
            { error: { code: "spam_risk_too_many_pending_share", message: "spam_risk_too_many_pending_share" } },
            { status: 400 }
          )
      }
    ]);
    const adapter = await loadAdapter();
    // resetModules gives the adapter its own copy of the module graph, so the
    // class to compare against has to come from that same copy.
    const { ThrottledError } = await import("@/lib/publisher/http");

    const error = await adapter.publish(input()).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ThrottledError);
    expect((error as InstanceType<typeof ThrottledError>).retryAfterMinutes).toBe(360);
    expect((error as Error).message).toMatch(/open the TikTok app/i);
  });

  it("resumes a pending publish_id by polling status only", async () => {
    const requests = routes();
    const adapter = await loadAdapter();

    const resumed = input();
    resumed.item.platforms.tiktok = { status: "uploaded", attempts: 1, containerId: "pub-9" };
    const result = await adapter.publish(resumed);

    expect(requests.some((r) => r.url.includes("/video/init/"))).toBe(false);
    expect(JSON.parse(String(requests[1].body))).toEqual({ publish_id: "pub-9" });
    expect(result.status).toBe("scheduled");
  });
});

describe("posting as an added TikTok account", () => {
  const EXTRA = "tiktok-a1b2c3d4";

  it("refreshes with that account's token, not the primary's", async () => {
    tokenCache.set("tiktok.refreshToken", "primary-refresh");
    tokenCache.set(`tiktok.refreshToken.${EXTRA}`, "extra-refresh");
    const requests = routes();
    const adapter = await loadAdapter();

    await adapter.publish(input({ accountId: EXTRA }));

    const refresh = formBody(requests.find((request) => request.url.includes("/oauth/token/"))!);
    expect(refresh.refresh_token).toBe("extra-refresh");
  });

  it("refuses to fall back to the primary when the account was never connected", async () => {
    tokenCache.set("tiktok.refreshToken", "primary-refresh");
    routes();
    const adapter = await loadAdapter();

    await expect(adapter.publish(input({ accountId: EXTRA }))).rejects.toThrow(/not connected/i);
  });

  it("does not spend one account's cached access token on another", async () => {
    tokenCache.set("tiktok.refreshToken", "primary-refresh");
    tokenCache.set(`tiktok.refreshToken.${EXTRA}`, "extra-refresh");
    const requests = routes();
    const adapter = await loadAdapter();

    await adapter.publish(input());
    await adapter.publish(input({ accountId: EXTRA }));

    const refreshes = requests
      .filter((request) => request.url.includes("/oauth/token/"))
      .map((request) => formBody(request).refresh_token);
    expect(refreshes).toEqual(["primary-refresh", "extra-refresh"]);
  });
});
