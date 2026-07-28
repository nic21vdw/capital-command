import { PermanentError, fetchJson } from "@/lib/publisher/http";
import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";

export const REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement"
] as const;

export type InstagramPage = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igUserId: string | null;
  igUsername: string | null;
};

export type InstagramConnection = {
  longLivedUserToken: string;
  userTokenExpiresAt: string | null;
  pages: InstagramPage[];
  page: InstagramPage;
  igUserId: string;
  igUsername: string | null;
  grantedScopes: string[];
  missingScopes: string[];
  quotaUsage: number | null;
};

export type ConnectOptions = {
  appId: string;
  appSecret: string;
  userToken: string;
  graphApiVersion?: string;
  pageId?: string;
};

type GraphError = { error?: { message?: string; type?: string; code?: number } };

function base(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

function graphMessage(payload: GraphError, fallback: string): string {
  return payload.error?.message ? `${fallback}: ${payload.error.message}` : fallback;
}

function expiryIso(expiresInSeconds: number | undefined, now: Date): string | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

export async function exchangeForLongLivedToken(
  options: Pick<ConnectOptions, "appId" | "appSecret" | "userToken"> & { graphApiVersion: string },
  now = new Date()
): Promise<{ token: string; expiresAt: string | null }> {
  const query = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: options.appId,
    client_secret: options.appSecret,
    fb_exchange_token: options.userToken
  });
  const data = await fetchJson<{ access_token?: string; expires_in?: number } & GraphError>(
    `${base(options.graphApiVersion)}/oauth/access_token?${query}`,
    { label: "Instagram token exchange", method: "GET" }
  );
  if (!data.access_token) {
    throw new PermanentError(
      graphMessage(
        data,
        "Meta did not return a long-lived token. Check the app id/secret and that the pasted token is fresh (they expire in ~1 hour)"
      )
    );
  }
  return { token: data.access_token, expiresAt: expiryIso(data.expires_in, now) };
}

export async function tokenScopes(
  options: { appId: string; appSecret: string; token: string; graphApiVersion: string }
): Promise<string[]> {
  const query = new URLSearchParams({
    input_token: options.token,
    access_token: `${options.appId}|${options.appSecret}`
  });
  const data = await fetchJson<{ data?: { scopes?: string[] } }>(
    `${base(options.graphApiVersion)}/debug_token?${query}`,
    { label: "Instagram token inspect", method: "GET" }
  ).catch(() => null);
  return data?.data?.scopes ?? [];
}

export async function listPages(token: string, graphApiVersion: string): Promise<InstagramPage[]> {
  const query = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
    access_token: token
  });
  const data = await fetchJson<
    {
      data?: Array<{
        id?: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: { id?: string; username?: string };
      }>;
    } & GraphError
  >(`${base(graphApiVersion)}/me/accounts?${query}`, { label: "Instagram page lookup", method: "GET" });

  if (!data.data) throw new PermanentError(graphMessage(data, "Meta returned no Pages for this token"));

  return data.data
    .filter((page): page is { id: string; name?: string; access_token: string } & typeof page =>
      Boolean(page.id && page.access_token)
    )
    .map((page) => ({
      pageId: page.id,
      pageName: page.name ?? page.id,
      pageAccessToken: page.access_token,
      igUserId: page.instagram_business_account?.id ?? null,
      igUsername: page.instagram_business_account?.username ?? null
    }));
}

export async function publishingQuota(
  igUserId: string,
  token: string,
  graphApiVersion: string
): Promise<number | null> {
  const query = new URLSearchParams({ fields: "quota_usage", access_token: token });
  const data = await fetchJson<{ data?: Array<{ quota_usage?: number }> }>(
    `${base(graphApiVersion)}/${igUserId}/content_publishing_limit?${query}`,
    { label: "Instagram publishing quota", method: "GET" }
  );
  const usage = data.data?.[0]?.quota_usage;
  return typeof usage === "number" ? usage : null;
}

function choosePage(pages: InstagramPage[], wanted?: string): InstagramPage {
  const linked = pages.filter((page) => page.igUserId);
  if (wanted) {
    const match = pages.find(
      (page) => page.pageId === wanted || page.pageName.toLowerCase() === wanted.toLowerCase()
    );
    if (!match) {
      throw new PermanentError(
        `No Page called "${wanted}" on this token. Available: ${pages.map((p) => `${p.pageName} (${p.pageId})`).join(", ") || "none"}`
      );
    }
    if (!match.igUserId) {
      throw new PermanentError(
        `Page "${match.pageName}" has no linked Instagram professional account. Link it in Meta Business Suite → Settings → Accounts, then re-run.`
      );
    }
    return match;
  }
  if (linked.length === 0) {
    throw new PermanentError(
      pages.length === 0
        ? "This token can see no Facebook Pages. Re-generate it with pages_show_list granted and the Page selected."
        : `None of these Pages has a linked Instagram professional account: ${pages.map((p) => p.pageName).join(", ")}. Convert the Instagram account to Business/Creator and link it to the Page.`
    );
  }
  if (linked.length > 1) {
    throw new PermanentError(
      `Several Pages have Instagram accounts — pick one with --page: ${linked
        .map((p) => `${p.pageName} (${p.pageId}) → @${p.igUsername ?? p.igUserId}`)
        .join(", ")}`
    );
  }
  return linked[0];
}

export async function connectInstagram(options: ConnectOptions, now = new Date()): Promise<InstagramConnection> {
  const graphApiVersion = options.graphApiVersion ?? publisherConfig().instagram.graphApiVersion;
  const { token: longLivedUserToken, expiresAt } = await exchangeForLongLivedToken(
    { ...options, graphApiVersion },
    now
  );
  const grantedScopes = await tokenScopes({
    appId: options.appId,
    appSecret: options.appSecret,
    token: longLivedUserToken,
    graphApiVersion
  });
  const pages = await listPages(longLivedUserToken, graphApiVersion);
  const page = choosePage(pages, options.pageId);
  const igUserId = page.igUserId as string;
  const quotaUsage = await publishingQuota(igUserId, page.pageAccessToken, graphApiVersion);

  return {
    longLivedUserToken,
    userTokenExpiresAt: expiresAt,
    pages,
    page,
    igUserId,
    igUsername: page.igUsername,
    grantedScopes,
    missingScopes: REQUIRED_SCOPES.filter(
      (scope) => grantedScopes.length > 0 && !grantedScopes.includes(scope)
    ),
    quotaUsage
  };
}

export function envUpdatesFor(
  connection: InstagramConnection,
  app: { appId: string; appSecret: string }
): Record<string, string> {
  return {
    IG_USER_ID: connection.igUserId,
    IG_ACCESS_TOKEN: connection.page.pageAccessToken,
    IG_APP_ID: app.appId,
    IG_APP_SECRET: app.appSecret,
    FB_PAGE_ID: connection.page.pageId,
    FB_PAGE_ACCESS_TOKEN: connection.page.pageAccessToken
  };
}

export function applyEnvUpdates(raw: string, updates: Record<string, string>): string {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const remaining = new Map(Object.entries(updates));

  const rewritten = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;
    const value = remaining.get(match[2]);
    if (value === undefined) return line;
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}=${value}`;
  });

  if (remaining.size > 0) {
    while (rewritten.length > 0 && rewritten[rewritten.length - 1].trim() === "") rewritten.pop();
    rewritten.push("", "# --- Instagram Reels publishing (written by `npm run publish:instagram:connect`)");
    for (const [key, value] of remaining) rewritten.push(`${key}=${value}`);
  }

  return `${rewritten.join(newline).replace(/\s+$/, "")}${newline}`;
}

export type InstagramStatus = {
  igUserId: string;
  username: string | null;
  followers: number | null;
  quotaUsage: number | null;
  tokenExpiresAt: string | null;
  neverExpires: boolean;
  grantedScopes: string[];
  missingScopes: string[];
};

export async function inspectInstagram(config: PublisherConfig = publisherConfig()): Promise<InstagramStatus> {
  const { userId, accessToken, graphApiVersion, appSecret } = config.instagram;
  if (!userId || !accessToken) {
    throw new PermanentError("Instagram is not connected yet. Run `npm run publish:instagram:connect` first.");
  }

  const query = new URLSearchParams({
    fields: "username,followers_count",
    access_token: accessToken
  });
  const profile = await fetchJson<{ username?: string; followers_count?: number }>(
    `${base(graphApiVersion)}/${userId}?${query}`,
    { label: "Instagram profile", method: "GET" }
  );
  const quotaUsage = await publishingQuota(userId, accessToken, graphApiVersion).catch(() => null);

  let tokenExpiresAt: string | null = null;
  let neverExpires = false;
  let grantedScopes: string[] = [];
  if (appSecret && config.instagram.appId) {
    const debugQuery = new URLSearchParams({
      input_token: accessToken,
      access_token: `${config.instagram.appId}|${appSecret}`
    });
    const debug = await fetchJson<{ data?: { expires_at?: number; scopes?: string[] } }>(
      `${base(graphApiVersion)}/debug_token?${debugQuery}`,
      { label: "Instagram token inspect", method: "GET" }
    ).catch(() => null);
    const expiresAt = debug?.data?.expires_at;
    neverExpires = expiresAt === 0;
    tokenExpiresAt = expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
    grantedScopes = debug?.data?.scopes ?? [];
  }

  return {
    igUserId: userId,
    username: profile.username ?? null,
    followers: typeof profile.followers_count === "number" ? profile.followers_count : null,
    quotaUsage,
    tokenExpiresAt,
    neverExpires,
    grantedScopes,
    missingScopes: REQUIRED_SCOPES.filter(
      (scope) => grantedScopes.length > 0 && !grantedScopes.includes(scope)
    )
  };
}
