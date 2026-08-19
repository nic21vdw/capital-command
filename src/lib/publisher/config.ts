import { readFileSync } from "node:fs";
import { ALL_PLATFORMS, type PlatformId, type Visibility } from "@/lib/publisher/types";
import { dataPath } from "@/lib/paths";

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
  /** Queue persistence: local JSON file, or the same JSON object stored in R2/S3 (required for GitHub Actions). */
  queueBackend: "file" | "r2";
  maxAttempts: number;
  /** First retry delay; doubles per attempt, capped at backoffCapMinutes. */
  backoffBaseMinutes: number;
  backoffCapMinutes: number;
  /** A platform claimed longer ago than this is considered abandoned and retried. */
  claimTimeoutMinutes: number;

  /**
   * One schedule for every platform. The calendar is built on the lead
   * platform (YouTube) and each runner tick copies its upcoming slots onto the
   * others, so a clip scheduled once goes out everywhere at that instant
   * without anyone maintaining a second calendar. On by default; set
   * PUBLISH_MIRROR=false to schedule each platform by hand again.
   */
  mirror: {
    enabled: boolean;
    lead: PlatformId;
    /** Platforms that follow the lead — only the configured ones are touched. */
    targets: PlatformId[];
    /**
     * "match"   the same clip at the same instant on every platform.
     * "shuffle" the same slots, but each platform plays the clips in its own
     *           order so the feeds don't read as carbon copies.
     */
    mode: "match" | "shuffle";
  };

  youtube: {
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    /** Optional YouTube category id for uploads (e.g. "22" People & Blogs, "20" Gaming). */
    categoryId: string | null;
    /**
     * Self-imposed uploads/day cap (~1600 quota units each of 10,000). It is not
     * only the meter's number: the runner stops uploading when the day's count
     * reaches it and sends the rest tomorrow, which is what keeps a batch from
     * emptying the day's allowance in one pass.
     */
    dailyUploadBudget: number;
    /**
     * Check the channel's own recent uploads for this title before posting, and
     * refuse a video that is already up. On unless YOUTUBE_DUPLICATE_GUARD=false.
     */
    duplicateGuard: boolean;
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
    /** Meta app id — with the secret it forms the app token used to inspect access tokens. */
    appId: string | null;
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
  /**
   * Spotify Web API — read-only. Spotify has no creator write API, so these
   * credentials never publish anything: they are how the app checks whether an
   * episode the RSS feed offered has actually landed on Spotify yet.
   */
  spotify: {
    clientId: string | null;
    clientSecret: string | null;
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
  /**
   * Buffer (buffer.com) — the social-media-manager delivery layer. When
   * enabled, the runner also schedules each due post into Buffer, which fans it
   * out to every channel connected inside Buffer and publishes at the target
   * time. Off by default; with BUFFER_ENABLED unset the runner never touches
   * Buffer and behaves exactly as before.
   */
  buffer: {
    enabled: boolean;
    accessToken: string | null;
    /** Buffer profile ids to post to (dashboard → each channel's settings). */
    profileIds: string[];
    /** Buffer API base; overridable so a proxy/newer host can be pointed at. */
    apiBase: string;
    /** Let Buffer auto-shorten links in the post text. */
    shortenLinks: boolean;
  };
};

/**
 * A refresh token minted by an in-app connect flow ("Connect YouTube" via
 * /api/auth/google, "Connect TikTok" via /api/auth/tiktok), persisted by
 * tokens.ts in data/publisher-tokens.json. A connected token wins locally so
 * reconnecting replaces a stale .env grant. This read must be synchronous
 * because publisherConfig() is, so the r2 token backend is not consulted
 * here — set the *_REFRESH_TOKEN variables explicitly for GitHub Actions runs.
 */
function cachedRefreshToken(key: string): string | null {
  try {
    const raw = readFileSync(dataPath("publisher-tokens.json"), "utf8");
    const value = (JSON.parse(raw) as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** Reads a comma-separated platform list, falling back when unset or all junk. */
function platformList(name: string, fallback: PlatformId[]): PlatformId[] {
  const raw = str(name);
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is PlatformId => (ALL_PLATFORMS as string[]).includes(p));
  return parsed.length > 0 ? parsed : fallback;
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
    queueBackend: str("PUBLISH_QUEUE_BACKEND")?.toLowerCase() === "r2" ? "r2" : "file",
    maxAttempts: num("PUBLISH_MAX_ATTEMPTS", 5),
    backoffBaseMinutes: num("PUBLISH_BACKOFF_BASE_MINUTES", 2),
    backoffCapMinutes: num("PUBLISH_BACKOFF_CAP_MINUTES", 120),
    claimTimeoutMinutes: num("PUBLISH_CLAIM_TIMEOUT_MINUTES", 15),
    mirror: {
      enabled: flag("PUBLISH_MIRROR", true),
      lead: platformList("PUBLISH_MIRROR_LEAD", ["youtube"])[0] ?? "youtube",
      // TikTok is left out until its app clears audit — an unaudited client
      // can only drop clips in the creator's inbox, which is not a schedule.
      targets: platformList("PUBLISH_MIRROR_TARGETS", ["instagram", "facebook"]),
      mode: str("PUBLISH_MIRROR_MODE")?.toLowerCase() === "shuffle" ? "shuffle" : "match"
    },
    youtube: {
      clientId: str("YOUTUBE_CLIENT_ID"),
      clientSecret: str("YOUTUBE_CLIENT_SECRET"),
      refreshToken: cachedRefreshToken("youtube.refreshToken") ?? str("YOUTUBE_REFRESH_TOKEN"),
      categoryId: str("YOUTUBE_CATEGORY_ID"),
      dailyUploadBudget: num("YOUTUBE_DAILY_UPLOAD_BUDGET", 6),
      duplicateGuard: flag("YOUTUBE_DUPLICATE_GUARD", true)
    },
    instagram: {
      userId: str("IG_USER_ID"),
      accessToken: str("IG_ACCESS_TOKEN"),
      // VERIFY: bump as Meta retires Graph API versions — see the changelog at
      // https://developers.facebook.com/docs/graph-api/changelog
      graphApiVersion: str("IG_GRAPH_API_VERSION") ?? "v23.0",
      webhookVerifyToken: str("IG_WEBHOOK_VERIFY_TOKEN"),
      appSecret: str("IG_APP_SECRET"),
      appId: str("IG_APP_ID")
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
      refreshToken: cachedRefreshToken("tiktok.refreshToken") ?? str("TIKTOK_REFRESH_TOKEN"),
      audited: flag("TIKTOK_AUDITED")
    },
    spotify: {
      clientId: str("SPOTIFY_CLIENT_ID"),
      clientSecret: str("SPOTIFY_CLIENT_SECRET")
    },
    s3: {
      endpoint: str("S3_ENDPOINT"),
      bucket: str("S3_BUCKET"),
      accessKeyId: str("S3_ACCESS_KEY_ID"),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
      region: str("S3_REGION") ?? "auto",
      publicBaseUrl: str("S3_PUBLIC_BASE_URL")
    },
    buffer: {
      enabled: flag("BUFFER_ENABLED"),
      accessToken: str("BUFFER_ACCESS_TOKEN"),
      profileIds: (str("BUFFER_PROFILE_IDS") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      // VERIFY: Buffer's classic REST host. Override BUFFER_API_BASE if Buffer
      // moves you to a newer host — see https://buffer.com/developers/api
      apiBase: (str("BUFFER_API_BASE") ?? "https://api.bufferapp.com/1").replace(/\/+$/, ""),
      shortenLinks: flag("BUFFER_SHORTEN_LINKS", true)
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

/**
 * Whether Buffer can actually publish: enabled, with a token and at least one
 * target profile. When enabled but not fully configured, the runner records
 * Buffer posts as "manual" reminders instead of failing.
 */
export function bufferConfigured(config = publisherConfig()): boolean {
  return Boolean(config.buffer.enabled && config.buffer.accessToken && config.buffer.profileIds.length > 0);
}
