import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import { jsonResponse, mockFetchRoutes, type RecordedRequest } from "@/lib/publisher/test-helpers";

const REDIRECT = "http://localhost:3000/api/linkedin/callback";

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const auth = () => import("@/lib/publisher/linkedinAuth");
const store = () => import("@/lib/publisher/tokens");

async function startFlow(options: { pages?: boolean } = {}) {
  const { linkedinAuthUrl } = await auth();
  const url = new URL(await linkedinAuthUrl(REDIRECT, options));
  return { url, state: url.searchParams.get("state")! };
}

function tokenRoutes(
  token: Record<string, unknown> = { access_token: "at-1", expires_in: 5184000, scope: "openid,profile,w_member_social" },
  extra: Parameters<typeof mockFetchRoutes>[0] = []
): RecordedRequest[] {
  return mockFetchRoutes([
    ...extra,
    { match: "/oauth/v2/accessToken", respond: () => jsonResponse(token) },
    { match: "/v2/userinfo", respond: () => jsonResponse({ sub: "abc123", name: "Nic Vandewetering", picture: "https://media.licdn.com/me.jpg" }) }
  ]);
}

describe("the sign-in link", () => {
  it("refuses to start while the client id and secret are not set", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "");
    const { linkedinAuthUrl, linkedinConfigured } = await auth();
    expect(linkedinConfigured()).toBe(false);
    await expect(linkedinAuthUrl(REDIRECT)).rejects.toThrow("Add the LinkedIn client ID and secret in Settings > Accounts first.");
  });

  it("asks for the member scopes with a fresh state, and no PKCE by default", async () => {
    const first = await startFlow();
    const second = await startFlow();

    expect(first.url.origin + first.url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(Object.fromEntries(first.url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "li-client",
      redirect_uri: REDIRECT,
      scope: "openid profile w_member_social"
    });
    expect(first.state.length).toBeGreaterThanOrEqual(32);
    expect(first.state).not.toBe(second.state);
    expect(first.url.searchParams.has("code_challenge")).toBe(false);
  });

  it("adds the company page scopes only when asked", async () => {
    const { url } = await startFlow({ pages: true });
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual(expect.arrayContaining(["w_member_social", "w_organization_social", "r_organization_admin"]));
  });

  it("sends a PKCE challenge when LINKEDIN_PKCE is on, and proves it at the token step", async () => {
    vi.stubEnv("LINKEDIN_PKCE", "true");
    const { url, state } = await startFlow();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const challenge = url.searchParams.get("code_challenge")!;

    const requests = tokenRoutes();
    await (await auth()).exchangeLinkedinCode({ code: "the-code", state, redirectUri: REDIRECT });

    const verifier = new URLSearchParams(String(requests[0].body)).get("code_verifier")!;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });
});

describe("the callback", () => {
  it("trades the code for a token, reads the member id from userinfo and stores both", async () => {
    const { state } = await startFlow();
    const requests = tokenRoutes();
    const before = Date.now();

    await (await auth()).exchangeLinkedinCode({ code: "the-code", state, redirectUri: REDIRECT });

    const form = new URLSearchParams(String(requests[0].body));
    expect(requests[0].url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect(requests[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: REDIRECT,
      client_id: "li-client",
      client_secret: "li-secret"
    });
    expect(requests[1].url).toBe("https://api.linkedin.com/v2/userinfo");
    expect(requests[1].headers.Authorization).toBe("Bearer at-1");

    const { getCachedToken } = await store();
    expect(await getCachedToken(LINKEDIN_KEYS.accessToken)).toBe("at-1");
    expect(await getCachedToken(LINKEDIN_KEYS.memberId)).toBe("abc123");
    expect(await getCachedToken(LINKEDIN_KEYS.author)).toBe("urn:li:person:abc123");
    expect(await getCachedToken(LINKEDIN_KEYS.refreshToken)).toBeFalsy();
    const expiresAt = Number(await getCachedToken(LINKEDIN_KEYS.accessExpiresAt));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5184000 * 1000);
    expect(await getCachedToken(LINKEDIN_KEYS.scope)).toBe("openid,profile,w_member_social");
    expect(JSON.parse((await getCachedToken(LINKEDIN_KEYS.profile))!)).toMatchObject({ name: "Nic Vandewetering" });
    const { linkedinConnected } = await auth();
    expect(await linkedinConnected()).toBe(true);
  });

  it("keeps the refresh token and its lifetime when LinkedIn issues one", async () => {
    const { state } = await startFlow();
    tokenRoutes({ access_token: "at-1", expires_in: 1800, refresh_token: "rt-1", refresh_token_expires_in: 31536000, scope: "openid,profile,w_member_social" });
    await (await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });
    const { getCachedToken } = await store();
    expect(await getCachedToken(LINKEDIN_KEYS.refreshToken)).toBe("rt-1");
    expect(Number(await getCachedToken(LINKEDIN_KEYS.refreshExpiresAt))).toBeGreaterThan(Date.now() + 360 * 86_400_000);
  });

  it("uses each state once", async () => {
    const { state } = await startFlow();
    tokenRoutes();
    const { exchangeLinkedinCode } = await auth();
    await exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });
    await expect(exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT })).rejects.toThrow("Click Connect LinkedIn again");
  });

  it("lets only one of two simultaneous callbacks use a state", async () => {
    const { state } = await startFlow();
    tokenRoutes();
    const { exchangeLinkedinCode } = await auth();
    const attempt = () => exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });

    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("keeps every state when two sign-ins start together", async () => {
    const [first, second] = await Promise.all([startFlow(), startFlow()]);
    tokenRoutes();
    const { exchangeLinkedinCode } = await auth();
    await exchangeLinkedinCode({ code: "c", state: first.state, redirectUri: REDIRECT });
    await exchangeLinkedinCode({ code: "c", state: second.state, redirectUri: REDIRECT });
  });

  it("rejects a state it never issued, without calling LinkedIn", async () => {
    await startFlow();
    const requests = tokenRoutes();
    await expect((await auth()).exchangeLinkedinCode({ code: "c", state: "forged", redirectUri: REDIRECT })).rejects.toThrow(
      "Click Connect LinkedIn again"
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects a state that has sat for more than ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { state } = await startFlow();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const requests = tokenRoutes();
    await expect((await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT })).rejects.toThrow(
      "Click Connect LinkedIn again"
    );
    expect(requests).toHaveLength(0);
  });

  it("stores nothing when LinkedIn refuses the code", async () => {
    const { state } = await startFlow();
    mockFetchRoutes([
      { match: "/oauth/v2/accessToken", respond: () => jsonResponse({ error: "invalid_request", error_description: "Unable to retrieve access token: authorization code not found" }, { status: 400 }) }
    ]);
    await expect((await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT })).rejects.toThrow("authorization code not found");
    expect(await (await store()).getCachedToken(LINKEDIN_KEYS.accessToken)).toBeNull();
  });

  it("finds the pages the member administers when page scopes were granted", async () => {
    const { state } = await startFlow({ pages: true });
    tokenRoutes(
      { access_token: "at-1", expires_in: 5184000, scope: "openid,profile,w_member_social,w_organization_social,r_organization_admin" },
      [
        {
          match: "/rest/organizationAcls",
          respond: () =>
            jsonResponse({ elements: [{ organization: "urn:li:organization:99", role: "ADMINISTRATOR", state: "APPROVED" }] })
        },
        { match: "/rest/organizations/99", respond: () => jsonResponse({ id: 99, localizedName: "CoLateral" }) }
      ]
    );

    await (await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });

    const authors = await (await auth()).linkedinAuthors();
    expect(authors.options).toEqual([
      { urn: "urn:li:person:abc123", name: "Nic Vandewetering", kind: "member" },
      { urn: "urn:li:organization:99", name: "CoLateral", kind: "organization" }
    ]);
    expect(authors.author).toBe("urn:li:person:abc123");
    expect(authors.canPostAsPage).toBe(true);
  });

  it("still connects the member when the page lookup is refused", async () => {
    const { state } = await startFlow({ pages: true });
    tokenRoutes(
      { access_token: "at-1", expires_in: 5184000, scope: "openid,profile,w_member_social,w_organization_social" },
      [{ match: "/rest/organizationAcls", respond: () => jsonResponse({ message: "Not enough permissions" }, { status: 403 }) }]
    );
    await (await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });
    expect((await (await auth()).linkedinAuthors()).options.map((option) => option.kind)).toEqual(["member"]);
  });

  it("keeps a page that was chosen before when the member signs in again", async () => {
    const { setCachedTokens } = await store();
    await setCachedTokens({
      [LINKEDIN_KEYS.organizations]: JSON.stringify([{ urn: "urn:li:organization:99", name: "CoLateral" }]),
      [LINKEDIN_KEYS.author]: "urn:li:organization:99"
    });
    const { state } = await startFlow({ pages: true });
    tokenRoutes(
      { access_token: "at-2", expires_in: 5184000, scope: "openid,profile,w_member_social,w_organization_social" },
      [
        { match: "/rest/organizationAcls", respond: () => jsonResponse({ elements: [{ organization: "urn:li:organization:99" }] }) },
        { match: "/rest/organizations/99", respond: () => jsonResponse({ localizedName: "CoLateral" }) }
      ]
    );
    await (await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });
    expect((await (await auth()).linkedinAuthors()).author).toBe("urn:li:organization:99");
  });
});

describe("choosing who posts", () => {
  async function connected() {
    const { state } = await startFlow({ pages: true });
    tokenRoutes(
      { access_token: "at-1", expires_in: 5184000, scope: "openid,profile,w_member_social,w_organization_social,r_organization_admin" },
      [
        { match: "/rest/organizationAcls", respond: () => jsonResponse({ elements: [{ organization: "urn:li:organization:99" }] }) },
        { match: "/rest/organizations/99", respond: () => jsonResponse({ localizedName: "CoLateral" }) }
      ]
    );
    await (await auth()).exchangeLinkedinCode({ code: "c", state, redirectUri: REDIRECT });
  }

  it("switches between the member and a page", async () => {
    await connected();
    const { selectLinkedinAuthor, linkedinAuthors } = await auth();
    await selectLinkedinAuthor("urn:li:organization:99");
    expect((await linkedinAuthors()).author).toBe("urn:li:organization:99");
    await selectLinkedinAuthor("urn:li:person:abc123");
    expect((await linkedinAuthors()).author).toBe("urn:li:person:abc123");
  });

  it("refuses an author that was not offered", async () => {
    await connected();
    await expect((await auth()).selectLinkedinAuthor("urn:li:organization:12345")).rejects.toThrow("not one of the accounts");
    await expect((await auth()).selectLinkedinAuthor("not-a-urn")).rejects.toThrow("not one of the accounts");
  });

  it("adds a page by its id when LinkedIn would not list it", async () => {
    await connected();
    mockFetchRoutes([{ match: "/rest/organizations/555", respond: () => jsonResponse({ localizedName: "Side Project" }) }]);
    const { addLinkedinOrganization, selectLinkedinAuthor, linkedinAuthors } = await auth();

    const added = await addLinkedinOrganization("555");

    expect(added).toEqual({ urn: "urn:li:organization:555", name: "Side Project", kind: "organization" });
    await selectLinkedinAuthor(added.urn);
    expect((await linkedinAuthors()).author).toBe("urn:li:organization:555");
  });

  it("names an added page by its id when LinkedIn will not say", async () => {
    await connected();
    mockFetchRoutes([{ match: "/rest/organizations/556", respond: () => jsonResponse({}, { status: 403 }) }]);
    expect(await (await auth()).addLinkedinOrganization("urn:li:organization:556")).toMatchObject({ name: "Page 556" });
  });

  it("rejects an id that is not a number", async () => {
    await connected();
    await expect((await auth()).addLinkedinOrganization("co-lateral")).rejects.toThrow("numeric");
  });
});

describe("the redirect address", () => {
  it("is the callback on the request origin unless LINKEDIN_REDIRECT_URI overrides it", async () => {
    const { linkedinRedirectUri } = await auth();
    expect(linkedinRedirectUri("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/linkedin/callback");
    vi.stubEnv("LINKEDIN_REDIRECT_URI", "https://example.test/cb");
    expect(linkedinRedirectUri("http://127.0.0.1:3000")).toBe("https://example.test/cb");
  });
});
