import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function issueState(): Promise<string> {
  const { linkedinAuthUrl } = await import("@/lib/publisher/linkedinAuth");
  return new URL(await linkedinAuthUrl("http://localhost:3000/api/linkedin/callback")).searchParams.get("state")!;
}

const callback = async (query: string) => {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest(`http://localhost:3000/api/linkedin/callback?${query}`));
  const location = new URL(response.headers.get("location")!, "http://localhost:3000");
  return { response, location };
};

describe("GET /api/linkedin/callback", () => {
  it("finishes the connection and lands on Settings > Accounts", async () => {
    const state = await issueState();
    mockFetchRoutes([
      { match: "/oauth/v2/accessToken", respond: () => jsonResponse({ access_token: "at", expires_in: 5184000, scope: "openid,profile,w_member_social" }) },
      { match: "/v2/userinfo", respond: () => jsonResponse({ sub: "abc123", name: "Nic" }) }
    ]);

    const { response, location } = await callback(`code=the-code&state=${state}`);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")!.startsWith("/settings")).toBe(true);
    expect(location.hash).toBe("#accounts");
    expect(location.searchParams.get("connected")).toBe("linkedin");
    const { getCachedToken } = await import("@/lib/publisher/tokens");
    expect(await getCachedToken(LINKEDIN_KEYS.author)).toBe("urn:li:person:abc123");
  });

  it("reports a state it did not issue and stores nothing", async () => {
    await issueState();
    const requests = mockFetchRoutes([]);
    const { location } = await callback("code=the-code&state=forged");
    expect(location.searchParams.get("connect")).toBe("linkedin");
    expect(location.searchParams.get("connect_error")).toContain("Click Connect LinkedIn again");
    expect(location.searchParams.has("connected")).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("reports a refusal on LinkedIn's consent screen", async () => {
    const state = await issueState();
    const { location } = await callback(`error=user_cancelled_authorize&error_description=The+user+cancelled+the+authorization&state=${state}`);
    expect(location.searchParams.get("connect_error")).toBe("The user cancelled the authorization");
    expect(location.searchParams.get("connect")).toBe("linkedin");
  });

  it("reports a missing code", async () => {
    const state = await issueState();
    const { location } = await callback(`state=${state}`);
    expect(location.searchParams.get("connect_error")).toContain("no authorization code");
  });

  it("reports a token exchange that LinkedIn rejects", async () => {
    const state = await issueState();
    mockFetchRoutes([
      { match: "/oauth/v2/accessToken", respond: () => jsonResponse({ error: "invalid_client", error_description: "Client authentication failed" }, { status: 401 }) }
    ]);
    const { location } = await callback(`code=c&state=${state}`);
    expect(location.searchParams.get("connect_error")).toContain("Client authentication failed");
  });
});
