import { readFileSync } from "node:fs";
import path from "node:path";
import { ALL_PLATFORMS, type PlatformId, type Visibility } from "@/lib/publisher/types";

/**
 * All publisher configuration comes from environment variables (.env locally,
 * repo secrets in GitHub Actions) so nothing sensitive is ever committed.
 * Everything is off by default: with no publisher vars set, the clipper
 * behaves exactly as before.
 */

function flag(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function str(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function num(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export type PublisherConfig = {
  /** Master switch — gates the export hook and the API routes. */
  enabled: boolean;
  /** Auto-enqueue finished editor exports (opt-in; manual enqueue always works when enabled). */
  autoEnqueue: boolean;
  /** Platforms enabled by default when an enqueue call doesn't name any. */
  platforms: PlatformId[];
  timezone: string;
  defaultVisibility: Visibility;
  /** Auto-enqueued exports are scheduled this far in the future. */
  autoEnqueueDelayMinutes: number;
  /** Queue persistence: local JSON file, or the same JSON object stored in R2/S3 (required for GitHub Actions). */
  queueBackend: "file" | "r2";
  maxAttempts: number;
  /** First retry delay; doubles per attempt, capped at backoffCapMinutes. */
  backoffBaseMinutes: number;
  backoffCapMinutes: number;
  /** A platform claimed longer ago than this is considered abandoned and retried. */
  claimTimeoutMinutes: number;

  youtube: {
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    /** Optional YouTube category id for uploads (e.g. "22" People & Blogs, "20" Gaming). */
    categoryId: string | null;
    /** Self-imposed uploads/day cap for the quota meter (~1600 units each of 10,000). */
    dailyUploadBudget: number;
  };
  instagram: {
    /** The Instagram professional account's user id (not the username). */
    userId: string | null;
    accessToken: string | null;
    graphApiVersion: string;
    /** Arbitrary string you also enter in the Meta App Dashboard webhook config. */
    webhookVerifyToken: string | null;
    /** Meta app secret, used to verify the X-Hub-Signature-256 header on incoming webhook events. */
    appSecret: string | null;
  };
  facebook: {
    /** The Facebook Page id to post to (not the user id). */
    pageId: string | null;
    /** Page access token (not a user token) with pages_manage_posts. */
    pageAccessToken: string | null;
    graphApiVersion: string;
  };
  tiktok: {
    clientKey: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    /**
     * Until the TikTok app passes audit, the Content Posting API only allows
     * SELF_ONLY posts. Flip TIKTOK_AUDITED=true after approval to honor the
     * configured visibility (public → PUBLIC_TO_EVERYONE).
     */
    audited: boolean;
  };
  s3: {
    endpoint: string | null;
    bucket: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    region: string;
    /**
     * Optional public base URL for the bucket (e.g. an R2 public bucket URL or
     * custom domain). When unset, time-limited presigned GET URLs are used.
     */
    publicBaseUrl: string | null;
  };
};

/**
 * Refresh token minted by the in-app "Connect YouTube" flow
 * (/api/auth/google), persisted by tokens.ts in data/publisher-tokens.json.
 * A token minted by Connect YouTube wins locally so reconnecting replaces a
 * stale .env grant. This read must be synchronous because publisherConfig()
 * is, so the r2 token backend is not consulted here — set
 * YOUTUBE_REFRESH_TOKEN explicitly for GitHub Actions runs.
 */
function cachedYoutubeRefreshToken(): string | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), "data", "publisher-tokens.json"), "utf8");
    const value = (JSON.parse(raw) as Record<string, unknown>)["youtube.refreshToken"];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

export function publisherConfig(): PublisherConfig {
  const platformsRaw = str("PUBLISH_PLATFORMS");
  const platforms = platformsRaw
    ? (platformsRaw
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter((p): p is PlatformId => (ALL_PLATFORMS as string[]).includes(p)))
    : [...ALL_PLATFORMS];
  const visibilityRaw = str("PUBLISH_DEFAULT_VISIBILITY")?.toLowerCase();
  const defaultVisibility: Visibility =
    visibilityRaw === "public" || visibilityRaw === "unlisted" ? visibilityRaw : "private";

  return {
    enabled: flag("PUBLISH_ENABLED"),
    autoEnqueue: flag("PUBLISH_AUTO_ENQUEUE"),
    platforms,
    timezone: str("PUBLISH_TIMEZONE") ?? "America/Toronto",
    defaultVisibility,
    autoEnqueueDelayMinutes: num("PUBLISH_AUTO_ENQUEUE_DELAY_MINUTES", 60),
    queueBackend: str("PUBLISH_QUEUE_BACKEND")?.toLowerCase() === "r2" ? "r2" : "file",
    maxAttempts: num("PUBLISH_MAX_ATTEMPTS", 5),
    backoffBaseMinutes: num("PUBLISH_BACKOFF_BASE_MINUTES", 2),
    backoffCapMinutes: num("PUBLISH_BACKOFF_CAP_MINUTES", 120),
    claimTimeoutMinutes: num("PUBLISH_CLAIM_TIMEOUT_MINUTES", 15),
    youtube: {
      clientId: str("YOUTUBE_CLIENT_ID"),
      clientSecret: str("YOUTUBE_CLIENT_SECRET"),
      refreshToken: cachedYoutubeRefreshToken() ?? str("YOUTUBE_REFRESH_TOKEN"),
      categoryId: str("YOUTUBE_CATEGORY_ID"),
      dailyUploadBudget: num("YOUTUBE_DAILY_UPLOAD_BUDGET", 6)
    },
    instagram: {
      userId: str("IG_USER_ID"),
      accessToken: str("IG_ACCESS_TOKEN"),
      // VERIFY: bump as Meta retires Graph API versions — see the changelog at
      // https://developers.facebook.com/docs/graph-api/changelog
      graphApiVersion: str("IG_GRAPH_API_VERSION") ?? "v23.0",
      webhookVerifyToken: str("IG_WEBHOOK_VERIFY_TOKEN"),
      appSecret: str("IG_APP_SECRET")
    },
    facebook: {
      pageId: str("FB_PAGE_ID"),
      pageAccessToken: str("FB_PAGE_ACCESS_TOKEN"),
      // VERIFY: bump as Meta retires Graph API versions — see the changelog at
      // https://developers.facebook.com/docs/graph-api/changelog
      graphApiVersion: str("FB_GRAPH_API_VERSION") ?? "v23.0"
    },
    tiktok: {
      clientKey: str("TIKTOK_CLIENT_KEY"),
      clientSecret: str("TIKTOK_CLIENT_SECRET"),
      refreshToken: str("TIKTOK_REFRESH_TOKEN"),
      audited: flag("TIKTOK_AUDITED")
    },
    s3: {
      endpoint: str("S3_ENDPOINT"),
      bucket: str("S3_BUCKET"),
      accessKeyId: str("S3_ACCESS_KEY_ID"),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
      region: str("S3_REGION") ?? "auto",
      publicBaseUrl: str("S3_PUBLIC_BASE_URL")
    }
  };
}

/** Which of the enabled platforms actually have credentials configured. */
export function configuredPlatforms(config = publisherConfig()): PlatformId[] {
  return config.platforms.filter((p) => {
    if (p === "youtube") {
      return Boolean(config.youtube.clientId && config.youtube.clientSecret && config.youtube.refreshToken);
    }
    if (p === "instagram") return Boolean(config.instagram.userId && config.instagram.accessToken);
    if (p === "facebook") return Boolean(config.facebook.pageId && config.facebook.pageAccessToken);
    return Boolean(config.tiktok.clientKey && config.tiktok.clientSecret && config.tiktok.refreshToken);
  });
}

export function hostingConfigured(config = publisherConfig()): boolean {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = config.s3;
  return Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
}
