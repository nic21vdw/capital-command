import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { getCachedToken, setCachedToken } from "@/lib/publisher/tokens";

/**
 * TikTok OAuth 2.0 for the in-app "Connect TikTok" button — the same shape as
 * googleAuth.ts: the browser only ever sees TikTok's consent screen and a
 * redirect back to the Uploading Center, while the client secret and the
 * minted refresh token stay server-side in tokens.ts
 * (data/publisher-tokens.json).
 *
 * TikTok's WEB Login Kit only accepts https redirect URIs, which a localhost
 * tool cannot offer. Its DESKTOP Login Kit accepts http://localhost and
 * 127.0.0.1 instead, and requires PKCE — so the app must be registered with
 * Login Kit for Desktop and this flow always sends a code challenge. TikTok
 * hashes the verifier with SHA256 and expects it HEX encoded, not the
 * base64url that the PKCE RFC specifies.
 *
 * The verifier has to survive the round trip to TikTok and back into a
 * separate callback request, so it is parked in the same server-side cache as
 * the tokens and consumed once.
 *
 * Avatar URLs from TikTok are short-lived signed CDN links (about two days).
 * Caching that URL forever leaves a blank face in the UI once it expires, so
 * the bytes are mirrored into data/publisher/ and served at TIKTOK_AVATAR_URL.
 */

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_URL = "https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url,username";
const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
// video.upload puts a draft in the creator's inbox; video.publish is the
// Direct Post scope the adapter actually uses. user.info.basic is what the
// "Connected as …" badge reads.
const SCOPE = "user.info.basic,video.publish,video.upload";

export const TIKTOK_REFRESH_TOKEN_CACHE_KEY = "tiktok.refreshToken";
export const TIKTOK_CREATOR_CACHE_KEY = "tiktok.creator";
export const TIKTOK_AVATAR_URL = "/api/publish/tiktok-avatar";
const VERIFIER_CACHE_KEY = "tiktok.codeVerifier";
const AVATAR_BASENAME = "tiktok-avatar";
const AVATAR_EXTS = ["webp", "jpg", "jpeg", "png"] as const;

export type TiktokCreatorInfo = { title: string; thumbnail: string | null; handle: string | null };

function avatarDir(): string {
  return dataPath("publisher");
}

function contentTypeToExt(contentType: string | null): (typeof AVATAR_EXTS)[number] {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("webp")) return "webp";
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "webp";
}

function extToContentType(ext: string): string {
  if (ext === "webp") return "image/webp";
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

function isLocalAvatarUrl(thumbnail: string | null | undefined): boolean {
  return thumbnail === TIKTOK_AVATAR_URL || Boolean(thumbnail?.startsWith(`${TIKTOK_AVATAR_URL}?`));
}

/** The mirrored avatar file on disk, if a connect or refresh already wrote one. */
export async function resolveTiktokAvatarFile(): Promise<{ path: string; contentType: string } | null> {
  const dir = avatarDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  for (const ext of AVATAR_EXTS) {
    const name = `${AVATAR_BASENAME}.${ext}`;
    if (!names.includes(name)) continue;
    const filePath = path.join(dir, name);
    try {
      await access(filePath);
      return { path: filePath, contentType: extToContentType(ext) };
    } catch {
      // try the next extension
    }
  }
  return null;
}

async function clearMirroredAvatars(): Promise<void> {
  const dir = avatarDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    AVATAR_EXTS.map(async (ext) => {
      const name = `${AVATAR_BASENAME}.${ext}`;
      if (!names.includes(name)) return;
      await unlink(path.join(dir, name)).catch(() => undefined);
    })
  );
}

/** Pulls a signed CDN avatar into data/publisher so the UI never depends on it. */
async function mirrorAvatar(remoteUrl: string): Promise<boolean> {
  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) return false;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return false;
    const ext = contentTypeToExt(response.headers.get("content-type"));
    const dir = avatarDir();
    await mkdir(dir, { recursive: true });
    await clearMirroredAvatars();
    await writeFile(path.join(dir, `${AVATAR_BASENAME}.${ext}`), buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer a durable local avatar URL over TikTok's short-lived CDN link. When
 * the remote is already expired, returns the profile with a null thumbnail so
 * the caller can refresh for a fresh URL.
 */
async function withLocalAvatar(info: TiktokCreatorInfo): Promise<TiktokCreatorInfo> {
  if (!info.thumbnail) {
    if (await resolveTiktokAvatarFile()) return { ...info, thumbnail: TIKTOK_AVATAR_URL };
    return info;
  }
  if (isLocalAvatarUrl(info.thumbnail)) {
    if (await resolveTiktokAvatarFile()) return { ...info, thumbnail: TIKTOK_AVATAR_URL };
    return { ...info, thumbnail: null };
  }
  if (await mirrorAvatar(info.thumbnail)) return { ...info, thumbnail: TIKTOK_AVATAR_URL };
  return info;
}

/**
 * Signed in and refreshing, but TikTok's audit gate still routes clips to the
 * creator inbox instead of posting them — see the adapter for why forcing
 * SELF_ONLY is not enough to get around it.
 */
export const TIKTOK_AUDIT_BLOCKER =
  "Connected, but the TikTok app is still unaudited — clips land in the creator inbox to finish in the app " +
  "instead of posting. Set TIKTOK_AUDITED=true once approved.";

/**
 * The redirect URI TikTok sends the browser back to. It must match the value
 * registered in the developer portal character for character, so an explicit
 * TIKTOK_REDIRECT_URI wins over the origin the request came in on (the app is
 * reachable as localhost and 127.0.0.1, only one of which may be registered).
 */
export function tiktokRedirectUri(origin: string): string {
  return process.env.TIKTOK_REDIRECT_URI?.trim() || `${origin}/api/auth/tiktok/callback`;
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("hex");
}

export async function tiktokAuthUrl(redirectUri: string): Promise<string> {
  const { tiktok } = publisherConfig();
  if (!tiktok.clientKey || !tiktok.clientSecret) {
    throw new Error(
      "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env first (developers.tiktok.com → your app → Login Kit for Desktop, redirect URI " +
        `${redirectUri}).`
    );
  }
  const verifier = randomBytes(48).toString("hex");
  await setCachedToken(VERIFIER_CACHE_KEY, verifier);
  const params = new URLSearchParams({
    client_key: tiktok.clientKey,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state: randomBytes(12).toString("hex"),
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256"
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchanges the callback code and persists the refresh token backend-side. */
export async function exchangeTiktokCode(code: string, redirectUri: string): Promise<void> {
  const { tiktok } = publisherConfig();
  if (!tiktok.clientKey || !tiktok.clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured.");
  }
  const verifier = await getCachedToken(VERIFIER_CACHE_KEY);
  if (!verifier) {
    throw new Error("This connection attempt expired — click Connect TikTok again.");
  }
  const data = await fetchJson<{
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>(TOKEN_URL, {
    label: "TikTok OAuth code exchange",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      // TikTok URL-encodes the code it puts on the callback (it can end in
      // "*"), and the exchange wants it decoded.
      code: decodeURIComponent(code),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });
  if (!data.refresh_token) {
    throw new Error(
      `TikTok returned no refresh token: ${data.error ?? ""} ${data.error_description ?? ""}`.trim()
    );
  }
  await setCachedToken(TIKTOK_REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
  await setCachedToken(VERIFIER_CACHE_KEY, "");
  if (data.access_token) {
    try {
      const info = await fetchCreatorInfo(data.access_token);
      if (info) {
        const localized = await withLocalAvatar(info);
        await setCachedToken(TIKTOK_CREATOR_CACHE_KEY, JSON.stringify(localized));
      }
    } catch {
      // The badge falls back to plain "TikTok connected"; the connection itself succeeded.
    }
  }
}

async function fetchUserInfo(accessToken: string): Promise<TiktokCreatorInfo | null> {
  const data = await fetchJson<{ data?: { user?: { display_name?: string; avatar_url?: string; username?: string } } }>(
    USER_URL,
    { label: "TikTok user lookup", method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const user = data.data?.user;
  if (!user?.display_name) return null;
  return { title: user.display_name, thumbnail: user.avatar_url ?? null, handle: user.username ?? null };
}

/**
 * The same profile read off the Content Posting API's creator query. It is
 * covered by video.publish rather than user.info.basic, so it still answers
 * for a grant that never got the user-info scope — and it is the only one of
 * the two that returns the @handle.
 */
async function fetchPostingCreatorInfo(accessToken: string): Promise<TiktokCreatorInfo | null> {
  const data = await fetchJson<{
    data?: { creator_nickname?: string; creator_username?: string; creator_avatar_url?: string };
  }>(CREATOR_INFO_URL, {
    label: "TikTok creator lookup",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" }
  });
  const creator = data.data;
  const handle = creator?.creator_username ?? null;
  const title = creator?.creator_nickname ?? (handle ? `@${handle}` : null);
  if (!title) return null;
  return { title, thumbnail: creator?.creator_avatar_url ?? null, handle };
}

async function fetchCreatorInfo(accessToken: string): Promise<TiktokCreatorInfo | null> {
  try {
    const info = await fetchUserInfo(accessToken);
    if (info?.handle) return info;
    const posting = await fetchPostingCreatorInfo(accessToken);
    return posting ?? info;
  } catch {
    return fetchPostingCreatorInfo(accessToken).catch(() => null);
  }
}

/** A fresh access token from the persisted refresh token, or null. */
/**
 * A fresh access token from the persisted refresh token, or null when TikTok
 * is not connected. Exported for the routes that have to ask TikTok something
 * on the creator's behalf, such as the consent panel's creator_info lookup.
 */
export async function tiktokAccessToken(): Promise<string | null> {
  return accessTokenFromRefresh();
}

async function accessTokenFromRefresh(): Promise<string | null> {
  const { tiktok } = publisherConfig();
  const refreshToken = (await getCachedToken(TIKTOK_REFRESH_TOKEN_CACHE_KEY)) ?? tiktok.refreshToken;
  if (!tiktok.clientKey || !tiktok.clientSecret || !refreshToken) return null;
  const data = await fetchJson<{ access_token?: string; refresh_token?: string }>(TOKEN_URL, {
    label: "TikTok token refresh",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  }).catch(() => null);
  // TikTok rotates the refresh token on use; dropping the new one strands the
  // connection until someone reconnects by hand.
  if (data?.refresh_token && data.refresh_token !== refreshToken) {
    await setCachedToken(TIKTOK_REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
  }
  return data?.access_token ?? null;
}

// One network refresh per process — enough to recover an expired CDN avatar
// without hammering TikTok on every sidebar poll.
let creatorRefetched = false;

async function readStoredCreator(): Promise<TiktokCreatorInfo | null> {
  const cached = await getCachedToken(TIKTOK_CREATOR_CACHE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as TiktokCreatorInfo;
  } catch {
    return null;
  }
}

async function persistCreator(info: TiktokCreatorInfo): Promise<TiktokCreatorInfo> {
  const localized = await withLocalAvatar(info);
  await setCachedToken(TIKTOK_CREATOR_CACHE_KEY, JSON.stringify(localized));
  return localized;
}

/**
 * True when the cached profile still needs a TikTok round-trip: no handle,
 * no local avatar on disk, or a remote CDN thumbnail that may already be dead.
 */
async function needsCreatorRefresh(stored: TiktokCreatorInfo | null): Promise<boolean> {
  if (!stored?.handle) return true;
  if (isLocalAvatarUrl(stored.thumbnail) && (await resolveTiktokAvatarFile())) return false;
  if (stored.thumbnail?.startsWith("http")) {
    if (await mirrorAvatar(stored.thumbnail)) {
      stored.thumbnail = TIKTOK_AVATAR_URL;
      await setCachedToken(TIKTOK_CREATOR_CACHE_KEY, JSON.stringify(stored));
      return false;
    }
    return true;
  }
  return !(await resolveTiktokAvatarFile());
}

/** The connected account's display name, @handle and avatar, when known. */
export async function tiktokCreatorInfo(): Promise<TiktokCreatorInfo | null> {
  const stored = await readStoredCreator();
  if (!(await needsCreatorRefresh(stored))) {
    return stored ? { ...stored, thumbnail: TIKTOK_AVATAR_URL } : null;
  }
  if (creatorRefetched) {
    if (!stored) return null;
    const localized = await withLocalAvatar(stored);
    return localized;
  }
  creatorRefetched = true;
  const accessToken = await accessTokenFromRefresh();
  if (!accessToken) {
    if (!stored) return null;
    return withLocalAvatar(stored);
  }
  const fresh = await fetchCreatorInfo(accessToken);
  if (!fresh) {
    if (!stored) return null;
    return withLocalAvatar(stored);
  }
  return persistCreator(fresh);
}
