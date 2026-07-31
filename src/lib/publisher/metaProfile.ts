import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";

/**
 * Who the app posts as on Meta — the Instagram professional account and the
 * Facebook Page behind IG_ACCESS_TOKEN / FB_PAGE_ACCESS_TOKEN.
 *
 * Unlike YouTube and TikTok there is no connect flow to cache a profile at,
 * so these are read live from the Graph API and held in a short in-process
 * cache: the sidebar asks for them on every page load, and a Page's name and
 * handle change about once a year.
 *
 * Facebook also gets a publish-readiness check here. A Page token can be
 * perfectly valid — it reads the Page, it publishes to Instagram — and still
 * be unable to post a Reel, because Video Reels needs pages_manage_posts and
 * the Instagram permissions alone do not include it. That failure otherwise
 * only shows up at publish time, as a 403 on a clip that was due to go out.
 */

const CACHE_TTL_MS = 10 * 60_000;

export type MetaProfile = {
  title: string;
  handle: string | null;
  thumbnail: string | null;
};

/** The Page permission Video Reels publishing needs on top of the IG ones. */
export const FACEBOOK_PUBLISH_SCOPE = "pages_manage_posts";

export const FACEBOOK_SCOPE_BLOCKER =
  "Connected, but the Page token is missing pages_manage_posts — Reels will be refused. " +
  "Re-run npm run publish:instagram:connect with a user token that also grants pages_manage_posts.";

type Cached<T> = { at: number; value: T };
const cache = new Map<string, Cached<unknown>>();

async function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

export async function instagramProfile(config: PublisherConfig = publisherConfig()): Promise<MetaProfile | null> {
  const { userId, accessToken, graphApiVersion } = config.instagram;
  if (!userId || !accessToken) return null;
  return memo(`ig:${userId}`, async () => {
    const query = new URLSearchParams({
      fields: "username,name,profile_picture_url",
      access_token: accessToken
    });
    const data = await fetchJson<{ username?: string; name?: string; profile_picture_url?: string }>(
      `${graphBase(graphApiVersion)}/${userId}?${query}`,
      { label: "Instagram profile", method: "GET" }
    ).catch(() => null);
    if (!data) return null;
    const handle = data.username ?? null;
    const title = data.name ?? (handle ? `@${handle}` : null);
    return title ? { title, handle, thumbnail: data.profile_picture_url ?? null } : null;
  });
}

export async function facebookProfile(config: PublisherConfig = publisherConfig()): Promise<MetaProfile | null> {
  const { pageId, pageAccessToken, graphApiVersion } = config.facebook;
  if (!pageId || !pageAccessToken) return null;
  return memo(`fb:${pageId}`, async () => {
    const query = new URLSearchParams({
      fields: "name,username,picture{url}",
      access_token: pageAccessToken
    });
    const data = await fetchJson<{ name?: string; username?: string; picture?: { data?: { url?: string } } }>(
      `${graphBase(graphApiVersion)}/${pageId}?${query}`,
      { label: "Facebook page profile", method: "GET" }
    ).catch(() => null);
    if (!data?.name) return null;
    return { title: data.name, handle: data.username ?? null, thumbnail: data.picture?.data?.url ?? null };
  });
}

/**
 * Whether the Page token carries pages_manage_posts. Needs the app id/secret
 * to inspect the token; without them the answer is unknowable, and an unknown
 * is reported as ready so a working setup is never blocked by a missing
 * IG_APP_ID.
 */
export type FacebookProbe = { ready: boolean; detail: string };

/**
 * The definitive answer to "can this token actually post a Reel", asked of
 * the endpoint itself rather than inferred from the token's scope list.
 *
 * It opens video_reels with a deliberately unresolvable file_url. A token
 * without pages_manage_posts is refused at the permission gate — code 200,
 * "Subject does not have permission to post videos on this target" — before
 * Facebook ever looks at the URL. A token that has it gets past the gate and
 * fails on the URL instead, which is the answer we want. Facebook cannot
 * fetch the file either way, so no video, draft or container is created.
 */
export async function facebookPublishProbe(
  config: PublisherConfig = publisherConfig()
): Promise<FacebookProbe> {
  const { pageId, pageAccessToken, graphApiVersion } = config.facebook;
  if (!pageId || !pageAccessToken) return { ready: false, detail: "FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN are not set." };
  const response = await fetch(`${graphBase(graphApiVersion)}/${pageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      upload_phase: "start",
      file_url: "https://probe.invalid/permission-check.mp4",
      access_token: pageAccessToken
    })
  }).catch((error) => (error instanceof Error ? error : new Error(String(error))));
  if (response instanceof Error) return { ready: false, detail: `could not reach Meta: ${response.message}` };

  const body = await response.text();
  if (/pages_manage_posts/i.test(body)) {
    return { ready: false, detail: `missing ${FACEBOOK_PUBLISH_SCOPE} — reconnect Meta granting it.` };
  }
  if (response.ok) return { ready: true, detail: "video_reels accepted the request." };
  return { ready: true, detail: "past the permission gate (Meta rejected only the probe URL, as expected)." };
}

export async function facebookCanPublish(config: PublisherConfig = publisherConfig()): Promise<boolean> {
  const { pageAccessToken } = config.facebook;
  const { appId, appSecret, graphApiVersion } = config.instagram;
  if (!pageAccessToken) return false;
  if (!appId || !appSecret) return true;
  return memo(`fb-scopes:${pageAccessToken.slice(-12)}`, async () => {
    const query = new URLSearchParams({
      input_token: pageAccessToken,
      access_token: `${appId}|${appSecret}`
    });
    const data = await fetchJson<{ data?: { scopes?: string[] } }>(
      `${graphBase(graphApiVersion)}/debug_token?${query}`,
      { label: "Facebook token inspect", method: "GET" }
    ).catch(() => null);
    const scopes = data?.data?.scopes;
    if (!scopes || scopes.length === 0) return true;
    return scopes.includes(FACEBOOK_PUBLISH_SCOPE);
  });
}
