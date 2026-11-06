import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintOf } from "@/lib/platform-health/fingerprint";

const SECRETS: Record<string, string> = {
  YOUTUBE_CLIENT_ID: "sentinel-yt-client-id.apps.googleusercontent.com",
  YOUTUBE_CLIENT_SECRET: "sentinel-yt-client-secret",
  YOUTUBE_REFRESH_TOKEN: "sentinel-yt-refresh-token",
  IG_USER_ID: "17840000000000000",
  IG_ACCESS_TOKEN: "sentinel-ig-access-token",
  IG_APP_SECRET: "sentinel-ig-app-secret",
  IG_WEBHOOK_VERIFY_TOKEN: "sentinel-ig-verify-token",
  FB_PAGE_ID: "100000000000000",
  FB_PAGE_ACCESS_TOKEN: "sentinel-fb-page-token",
  THREADS_USER_ID: "1000000000",
  THREADS_ACCESS_TOKEN: "sentinel-threads-token-1",
  THREADS_ACCESS_TOKEN_2: "sentinel-threads-token-2",
  TIKTOK_CLIENT_KEY: "sentinel-tiktok-client-key",
  TIKTOK_CLIENT_SECRET: "sentinel-tiktok-client-secret",
  TIKTOK_REFRESH_TOKEN: "sentinel-tiktok-refresh-token",
  LINKEDIN_CLIENT_ID: "sentinel-linkedin-client-id",
  LINKEDIN_CLIENT_SECRET: "sentinel-linkedin-client-secret",
  SPOTIFY_CLIENT_ID: "sentinel-spotify-client-id",
  SPOTIFY_CLIENT_SECRET: "sentinel-spotify-client-secret",
  S3_ENDPOINT: "https://example.r2.test",
  S3_BUCKET: "bucket",
  S3_ACCESS_KEY_ID: "sentinel-s3-access-key-id",
  S3_SECRET_ACCESS_KEY: "sentinel-s3-secret-access-key",
  XAI_API_KEY: "sentinel-xai-api-key",
  OPENAI_API_KEY: "sentinel-openai-api-key",
  ANTHROPIC_API_KEY: "sentinel-anthropic-api-key",
  DEEPSEEK_API_KEY: "sentinel-deepseek-api-key",
  FAL_KEY: "sentinel-fal-key",
  PRODUCT_HUNT_TOKEN: "sentinel-product-hunt-token",
  BUFFER_ACCESS_TOKEN: "sentinel-buffer-token"
};

const CACHED: Record<string, string> = {
  "linkedin.accessToken": "sentinel-linkedin-access-token",
  "linkedin.refreshToken": "sentinel-linkedin-refresh-token",
  "linkedin.accessExpiresAt": new Date(Date.now() + 30 * 86_400_000).toISOString()
};

const SECRET_VALUES = [
  ...Object.entries(SECRETS).filter(([key]) => /TOKEN|SECRET|KEY/.test(key) && key !== "TIKTOK_CLIENT_KEY").map(([, value]) => value),
  CACHED["linkedin.accessToken"],
  CACHED["linkedin.refreshToken"]
];
const FINGERPRINTS = SECRET_VALUES.map((value) => fingerprintOf(value)).filter((value): value is string => Boolean(value));

type Read = () => Promise<Response>;
const get = (load: () => Promise<{ GET: (...args: never[]) => Promise<Response> }>, url: string): Read => async () => {
  const { GET } = await load();
  return (GET as (request: NextRequest) => Promise<Response>)(new NextRequest(`http://localhost:3000${url}`));
};

const READS: Array<[string, Read]> = [
  ["GET /api/connections", get(() => import("@/app/api/connections/route"), "/api/connections")],
  ["GET /api/publish/accounts", get(() => import("@/app/api/publish/accounts/route"), "/api/publish/accounts")],
  ["GET /api/health/platforms", get(() => import("@/app/api/health/platforms/route"), "/api/health/platforms")],
  ["GET /api/threads", get(() => import("@/app/api/threads/route"), "/api/threads")],
  ["GET /api/linkedin/author", get(() => import("@/app/api/linkedin/author/route"), "/api/linkedin/author")],
  ["GET /api/voice/xai-auth", get(() => import("@/app/api/voice/xai-auth/route"), "/api/voice/xai-auth")],
  ["GET /api/spotify", get(() => import("@/app/api/spotify/route"), "/api/spotify")],
  ["GET /api/podcast", get(() => import("@/app/api/podcast/route"), "/api/podcast")],
  ["GET /api/launch", get(() => import("@/app/api/launch/route"), "/api/launch")],
  ["GET /api/publish/overview", get(() => import("@/app/api/publish/overview/route"), "/api/publish/overview")],
  ["GET /api/automations", get(() => import("@/app/api/automations/route"), "/api/automations")],
  ["GET /api/backup/status", get(() => import("@/app/api/backup/status/route"), "/api/backup/status")],
  ["GET /api/publish", get(() => import("@/app/api/publish/route"), "/api/publish")],
  ["GET /api/data", get(() => import("@/app/api/data/route"), "/api/data")],
  ["GET /api/publish/tiktok/creator-info", get(() => import("@/app/api/publish/tiktok/creator-info/route"), "/api/publish/tiktok/creator-info")],
  ["GET /api/publish/youtube-channel", get(() => import("@/app/api/publish/youtube-channel/route"), "/api/publish/youtube-channel?refresh=1")],
  ["GET /api/publish/youtube-stats", get(() => import("@/app/api/publish/youtube-stats/route"), "/api/publish/youtube-stats?ids=dQw4w9WgXcQ&refresh=1")]
];

let logged: string[];

beforeEach(async () => {
  for (const [key, value] of Object.entries(SECRETS)) vi.stubEnv(key, value);
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "youtube,instagram,facebook,tiktok,linkedin");
  vi.stubEnv("PUBLISH_TIMEZONE", "America/Toronto");
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    throw new Error(`no network in this test: ${String(input)}`);
  }));
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
  const { setCachedTokens } = await import("@/lib/publisher/tokens");
  await setCachedTokens(CACHED);
  const { recordAuthFailure } = await import("@/lib/platform-health/store");
  await recordAuthFailure(
    { platform: "threads", accountId: "primary", accountLabel: "primary" },
    `HTTP 401 Session has expired: GET https://graph.threads.net/v1.0/me?fields=id&access_token=${SECRETS.THREADS_ACCESS_TOKEN} (Authorization: Bearer ${SECRETS.THREADS_ACCESS_TOKEN})`,
    { now: new Date(), fingerprint: fingerprintOf(SECRETS.THREADS_ACCESS_TOKEN) }
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function leaks(text: string): string[] {
  return [...SECRET_VALUES, ...FINGERPRINTS].filter((secret) => text.includes(secret));
}

describe("no read route answers with a credential or the fingerprint of one", () => {
  it.each(READS)("%s", async (_route, read) => {
    const response = await read();
    const body = await response.text();
    expect(response.status, body.slice(0, 300)).toBeLessThan(500);
    expect(leaks(body)).toEqual([]);
    expect(leaks(logged.join("\n"))).toEqual([]);
  });

  it("would notice a leak: the stored break really carries the token and fingerprint the routes must not repeat", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dataPath } = await import("@/lib/paths");
    const stored = await readFile(dataPath("platform-auth.json"), "utf8");
    expect(leaks(stored)).toEqual(expect.arrayContaining([SECRETS.THREADS_ACCESS_TOKEN, fingerprintOf(SECRETS.THREADS_ACCESS_TOKEN)]));
  });
});
