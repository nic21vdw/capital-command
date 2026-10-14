import { createHash, randomBytes } from "node:crypto";
import { noteRefreshAccepted, noteRefreshRejected } from "@/lib/platform-health/refresh";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { missingCredentialsMessage } from "@/lib/publisher/connectStart";
import { PermanentError, fetchJson } from "@/lib/publisher/http";
import { LINKEDIN_API_ORIGIN, LINKEDIN_REST, linkedinJson } from "@/lib/publisher/linkedinApi";
import { LINKEDIN_KEYS, LINKEDIN_PAGE_SCOPE, LINKEDIN_SETUP_DOC } from "@/lib/publisher/linkedinKeys";
import { getCachedToken, setCachedTokens, updateCachedTokens } from "@/lib/publisher/tokens";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = `${LINKEDIN_API_ORIGIN}/v2/userinfo`;
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 8;
const TOKEN_SKEW_MS = 5 * 60_000;
const DEFAULT_ACCESS_LIFETIME_S = 5_184_000;

export const LINKEDIN_MEMBER_SCOPES = ["openid", "profile", "w_member_social"];
export const LINKEDIN_PAGE_SCOPES = [LINKEDIN_PAGE_SCOPE, "r_organization_admin"];

export type LinkedinAuthor = { urn: string; name: string; kind: "member" | "organization" };

export type LinkedinAuthors = {
  enabled: boolean;
  connected: boolean;
  author: string | null;
  options: LinkedinAuthor[];
  canPostAsPage: boolean;
  expiresAt: string | null;
  renews: boolean;
};

type Pending = { state: string; verifier?: string; at: number };

export function linkedinConfigured(): boolean {
  const { linkedin } = publisherConfig();
  return Boolean(linkedin.clientId && linkedin.clientSecret);
}

export function linkedinRedirectUri(origin: string): string {
  return process.env.LINKEDIN_REDIRECT_URI?.trim() || `${origin}/api/linkedin/callback`;
}

function pkceEnabled(): boolean {
  const raw = process.env.LINKEDIN_PKCE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function scopeList(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/[,\s]+/).filter(Boolean);
}

function parsePending(raw: string | undefined): Pending[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as Pending[]).filter((entry) => typeof entry?.state === "string") : [];
  } catch {
    return [];
  }
}

const stillValid = (entry: Pending, now: number) => now - entry.at < STATE_TTL_MS;

export async function linkedinAuthUrl(redirectUri: string, options: { pages?: boolean } = {}): Promise<string> {
  const { linkedin } = publisherConfig();
  if (!linkedin.clientId || !linkedin.clientSecret) throw new Error(missingCredentialsMessage("linkedin"));
  const state = randomBytes(24).toString("hex");
  const verifier = pkceEnabled() ? randomBytes(32).toString("base64url") : undefined;
  const now = Date.now();
  await updateCachedTokens((current) => {
    const fresh = parsePending(current[LINKEDIN_KEYS.pending]).filter((entry) => stillValid(entry, now));
    const next = [...fresh, { state, ...(verifier ? { verifier } : {}), at: now }].slice(-MAX_PENDING);
    return { set: { [LINKEDIN_KEYS.pending]: JSON.stringify(next) }, result: undefined };
  });
  const scopes = [...LINKEDIN_MEMBER_SCOPES, ...(options.pages ? LINKEDIN_PAGE_SCOPES : [])];
  const params = new URLSearchParams({
    response_type: "code",
    client_id: linkedin.clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(" ")
  });
  if (verifier) {
    params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
  }
  return `${AUTH_URL}?${params.toString()}`;
}

async function consumePending(state: string): Promise<Pending | null> {
  const now = Date.now();
  return updateCachedTokens((current) => {
    const entries = parsePending(current[LINKEDIN_KEYS.pending]);
    const match = entries.find((entry) => entry.state === state);
    const remaining = entries.filter((entry) => entry !== match && stillValid(entry, now));
    return {
      set: { [LINKEDIN_KEYS.pending]: JSON.stringify(remaining) },
      result: match && stillValid(match, now) ? match : null
    };
  });
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

function tokenEntries(data: TokenResponse, now: number, previousRefresh?: { token: string | null; expiresAt: string | null }) {
  const entries: Record<string, string> = {
    [LINKEDIN_KEYS.accessToken]: data.access_token ?? "",
    [LINKEDIN_KEYS.accessExpiresAt]: String(now + (data.expires_in ?? DEFAULT_ACCESS_LIFETIME_S) * 1000)
  };
  if (data.refresh_token) {
    entries[LINKEDIN_KEYS.refreshToken] = data.refresh_token;
    entries[LINKEDIN_KEYS.refreshExpiresAt] = data.refresh_token_expires_in
      ? String(now + data.refresh_token_expires_in * 1000)
      : previousRefresh?.expiresAt ?? "";
  } else if (!previousRefresh) {
    entries[LINKEDIN_KEYS.refreshToken] = "";
    entries[LINKEDIN_KEYS.refreshExpiresAt] = "";
  }
  return entries;
}

async function discoverOrganizations(accessToken: string): Promise<LinkedinAuthor[]> {
  const acls = await linkedinJson<{ elements?: Array<{ organization?: string }> }>(
    `${LINKEDIN_REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
    { token: accessToken, label: "LinkedIn page lookup" }
  );
  const urns = (acls.elements ?? []).map((element) => element.organization).filter((urn): urn is string => Boolean(urn));
  const authors: LinkedinAuthor[] = [];
  for (const urn of [...new Set(urns)]) authors.push(await organizationAuthor(accessToken, urn));
  return authors;
}

async function organizationAuthor(accessToken: string, urn: string): Promise<LinkedinAuthor> {
  const id = urn.split(":").pop() ?? urn;
  const detail = await linkedinJson<{ localizedName?: string }>(`${LINKEDIN_REST}/organizations/${encodeURIComponent(id)}`, {
    token: accessToken,
    label: "LinkedIn page name lookup"
  }).catch(() => ({}) as { localizedName?: string });
  return { urn, name: detail.localizedName?.trim() || `Page ${id}`, kind: "organization" };
}

function parseOrganizations(raw: string | undefined): LinkedinAuthor[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is { urn: string; name?: string } => typeof entry?.urn === "string")
      .map((entry) => ({ urn: entry.urn, name: entry.name || entry.urn, kind: "organization" as const }));
  } catch {
    return [];
  }
}

async function storedOrganizations(): Promise<LinkedinAuthor[]> {
  return parseOrganizations((await getCachedToken(LINKEDIN_KEYS.organizations)) ?? undefined);
}

async function storedProfile(): Promise<{ name?: string; picture?: string }> {
  try {
    return JSON.parse((await getCachedToken(LINKEDIN_KEYS.profile)) || "{}") as { name?: string; picture?: string };
  } catch {
    return {};
  }
}

function mergeOrganizations(...lists: LinkedinAuthor[][]): LinkedinAuthor[] {
  const byUrn = new Map<string, LinkedinAuthor>();
  for (const author of lists.flat()) if (!byUrn.has(author.urn)) byUrn.set(author.urn, author);
  return [...byUrn.values()];
}

export async function exchangeLinkedinCode(input: { code: string; state: string; redirectUri: string }): Promise<void> {
  const { linkedin } = publisherConfig();
  if (!linkedin.clientId || !linkedin.clientSecret) throw new Error(missingCredentialsMessage("linkedin"));
  const pending = await consumePending(input.state);
  if (!pending) throw new Error("This connection attempt expired or was not started here. Click Connect LinkedIn again.");
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: linkedin.clientId,
    client_secret: linkedin.clientSecret
  });
  if (pending.verifier) form.set("code_verifier", pending.verifier);
  const data = await fetchJson<TokenResponse>(TOKEN_URL, {
    label: "LinkedIn sign-in",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (!data.access_token) throw new Error("LinkedIn returned no access token. Click Connect LinkedIn again.");

  const profile = await fetchJson<{ sub?: string; name?: string; picture?: string }>(USERINFO_URL, {
    label: "LinkedIn profile lookup",
    method: "GET",
    headers: { Authorization: `Bearer ${data.access_token}` }
  });
  if (!profile.sub) throw new Error("LinkedIn did not say which member signed in. Click Connect LinkedIn again.");

  const scopes = scopeList(data.scope);
  const previousOrganizations = await storedOrganizations();
  const discovered = scopes.includes(LINKEDIN_PAGE_SCOPE)
    ? await discoverOrganizations(data.access_token).catch(() => [] as LinkedinAuthor[])
    : [];
  const organizations = mergeOrganizations(discovered, previousOrganizations);
  const memberUrn = `urn:li:person:${profile.sub}`;
  const previousAuthor = await getCachedToken(LINKEDIN_KEYS.author);
  const author =
    previousAuthor && (previousAuthor === memberUrn || organizations.some((organization) => organization.urn === previousAuthor))
      ? previousAuthor
      : memberUrn;

  await setCachedTokens({
    ...tokenEntries(data, Date.now()),
    [LINKEDIN_KEYS.scope]: scopes.join(","),
    [LINKEDIN_KEYS.memberId]: profile.sub,
    [LINKEDIN_KEYS.profile]: JSON.stringify({ name: profile.name ?? "", picture: profile.picture ?? "" }),
    [LINKEDIN_KEYS.organizations]: JSON.stringify(organizations),
    [LINKEDIN_KEYS.author]: author
  });
  await noteRefreshAccepted("linkedin", primaryAccountId("linkedin"));
}

async function refreshLinkedinToken(refreshToken: string): Promise<string> {
  const { linkedin } = publisherConfig();
  if (!linkedin.clientId || !linkedin.clientSecret) throw new PermanentError(notConfiguredMessage());
  const accountId = primaryAccountId("linkedin");
  let data: TokenResponse;
  let accessToken: string;
  try {
    data = await fetchJson<TokenResponse>(TOKEN_URL, {
      label: "LinkedIn token refresh",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: linkedin.clientId,
        client_secret: linkedin.clientSecret
      })
    });
    if (!data.access_token) throw new PermanentError("LinkedIn token refresh failed: LinkedIn returned no access token.");
    accessToken = data.access_token;
  } catch (error) {
    await noteRefreshRejected("linkedin", accountId, error);
    throw error;
  }
  await setCachedTokens(
    tokenEntries(data, Date.now(), {
      token: refreshToken,
      expiresAt: (await getCachedToken(LINKEDIN_KEYS.refreshExpiresAt)) || null
    })
  );
  await noteRefreshAccepted("linkedin", accountId);
  return accessToken;
}

export function notConfiguredMessage(): string {
  return `LinkedIn is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (steps in ${LINKEDIN_SETUP_DOC}).`;
}

export async function linkedinAccessToken(now: Date = new Date()): Promise<string> {
  if (!linkedinConfigured()) throw new PermanentError(notConfiguredMessage());
  const access = await getCachedToken(LINKEDIN_KEYS.accessToken);
  if (!access) throw new PermanentError("LinkedIn is not connected - open Settings > Accounts and press Connect LinkedIn.");
  const expiresAt = Number(await getCachedToken(LINKEDIN_KEYS.accessExpiresAt));
  if (!Number.isFinite(expiresAt) || expiresAt - now.getTime() > TOKEN_SKEW_MS) return access;
  const refresh = await getCachedToken(LINKEDIN_KEYS.refreshToken);
  if (!refresh) {
    throw new PermanentError(
      "The LinkedIn connection expired or was revoked and LinkedIn did not issue a refresh token - reconnect LinkedIn in Settings > Accounts."
    );
  }
  return refreshLinkedinToken(refresh);
}

export async function linkedinConnected(now: Date = new Date()): Promise<boolean> {
  if (!linkedinConfigured()) return false;
  const access = await getCachedToken(LINKEDIN_KEYS.accessToken);
  if (!access) return false;
  const expiresAt = Number(await getCachedToken(LINKEDIN_KEYS.accessExpiresAt));
  if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) return true;
  return Boolean(await getCachedToken(LINKEDIN_KEYS.refreshToken));
}

export async function linkedinSession(): Promise<{ token: string; author: string; scopes: string[] }> {
  const token = await linkedinAccessToken();
  const author = await getCachedToken(LINKEDIN_KEYS.author);
  if (!author) throw new PermanentError("LinkedIn is not connected - open Settings > Accounts and press Connect LinkedIn.");
  return { token, author, scopes: scopeList(await getCachedToken(LINKEDIN_KEYS.scope)) };
}

export async function linkedinAuthors(): Promise<LinkedinAuthors> {
  const enabled = linkedinConfigured();
  const empty: LinkedinAuthors = {
    enabled,
    connected: false,
    author: null,
    options: [],
    canPostAsPage: false,
    expiresAt: null,
    renews: false
  };
  const memberId = await getCachedToken(LINKEDIN_KEYS.memberId);
  if (!enabled || !memberId || !(await getCachedToken(LINKEDIN_KEYS.accessToken))) return empty;
  const profile = await storedProfile();
  const memberUrn = `urn:li:person:${memberId}`;
  const options: LinkedinAuthor[] = [
    { urn: memberUrn, name: profile.name || "You", kind: "member" },
    ...(await storedOrganizations())
  ];
  const stored = await getCachedToken(LINKEDIN_KEYS.author);
  const author = stored && options.some((option) => option.urn === stored) ? stored : memberUrn;
  const refresh = Boolean(await getCachedToken(LINKEDIN_KEYS.refreshToken));
  const accessExpiry = Number(await getCachedToken(LINKEDIN_KEYS.accessExpiresAt));
  const refreshExpiry = Number(await getCachedToken(LINKEDIN_KEYS.refreshExpiresAt));
  const deadline = refresh ? refreshExpiry : accessExpiry;
  return {
    enabled,
    connected: await linkedinConnected(),
    author,
    options,
    canPostAsPage: scopeList(await getCachedToken(LINKEDIN_KEYS.scope)).includes(LINKEDIN_PAGE_SCOPE),
    expiresAt: Number.isFinite(deadline) && deadline > 0 ? new Date(deadline).toISOString() : null,
    renews: refresh
  };
}

export async function selectLinkedinAuthor(urn: string): Promise<void> {
  const { options } = await linkedinAuthors();
  if (!options.some((option) => option.urn === urn)) {
    throw new Error("That is not one of the accounts this LinkedIn sign-in can post as.");
  }
  await setCachedTokens({ [LINKEDIN_KEYS.author]: urn });
}

export async function addLinkedinOrganization(input: string): Promise<LinkedinAuthor> {
  const id = input.trim().replace(/^urn:li:organization:/, "");
  if (!/^\d+$/.test(id)) throw new Error("A LinkedIn page ID is numeric - it is the number in the page's admin address.");
  const token = await linkedinAccessToken();
  const author = await organizationAuthor(token, `urn:li:organization:${id}`);
  await updateCachedTokens((current) => ({
    set: { [LINKEDIN_KEYS.organizations]: JSON.stringify(mergeOrganizations(parseOrganizations(current[LINKEDIN_KEYS.organizations]), [author])) },
    result: undefined
  }));
  return author;
}

export async function linkedinProfile(): Promise<{ title: string; handle: string | null; thumbnail: string | null } | null> {
  const authors = await linkedinAuthors();
  if (!authors.connected || !authors.author) return null;
  const current = authors.options.find((option) => option.urn === authors.author);
  const profile = await storedProfile();
  return {
    title: current?.name ?? profile.name ?? "LinkedIn",
    handle: null,
    thumbnail: current?.kind === "member" ? profile.picture || null : null
  };
}
