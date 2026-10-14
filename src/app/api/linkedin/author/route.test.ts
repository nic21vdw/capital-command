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

async function connect() {
  const { setCachedTokens } = await import("@/lib/publisher/tokens");
  await setCachedTokens({
    [LINKEDIN_KEYS.accessToken]: "secret-access-token",
    [LINKEDIN_KEYS.accessExpiresAt]: String(Date.now() + 86_400_000 * 30),
    [LINKEDIN_KEYS.scope]: "openid,profile,w_member_social,w_organization_social",
    [LINKEDIN_KEYS.memberId]: "abc123",
    [LINKEDIN_KEYS.profile]: JSON.stringify({ name: "Nic" }),
    [LINKEDIN_KEYS.author]: "urn:li:person:abc123",
    [LINKEDIN_KEYS.organizations]: JSON.stringify([{ urn: "urn:li:organization:99", name: "CoLateral" }])
  });
}

const read = async () => (await import("./route")).GET();
const write = async (body: unknown) =>
  (await import("./route")).POST(
    new NextRequest("http://localhost:3000/api/linkedin/author", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" }
    })
  );

describe("/api/linkedin/author", () => {
  it("says LinkedIn is off while it is not set up", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    expect(await (await read()).json()).toMatchObject({ enabled: false, connected: false, options: [] });
  });

  it("lists the member and the pages with the current choice, and never the token", async () => {
    await connect();
    const body = await (await read()).json();
    expect(body).toMatchObject({
      enabled: true,
      connected: true,
      author: "urn:li:person:abc123",
      canPostAsPage: true,
      options: [
        { urn: "urn:li:person:abc123", name: "Nic", kind: "member" },
        { urn: "urn:li:organization:99", name: "CoLateral", kind: "organization" }
      ]
    });
    expect(JSON.stringify(body)).not.toContain("secret-access-token");
  });

  it("switches the author", async () => {
    await connect();
    const response = await write({ author: "urn:li:organization:99" });
    expect(response.status).toBe(200);
    expect((await response.json()).author).toBe("urn:li:organization:99");
  });

  it("refuses an author that was not offered", async () => {
    await connect();
    const response = await write({ author: "urn:li:organization:1" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("not one of the accounts");
  });

  it("adds a page by id", async () => {
    await connect();
    mockFetchRoutes([{ match: "/rest/organizations/555", respond: () => jsonResponse({ localizedName: "Side Project" }) }]);
    const response = await write({ organizationId: "555" });
    expect(response.status).toBe(200);
    expect((await response.json()).options.map((option: { urn: string }) => option.urn)).toContain("urn:li:organization:555");
  });

  it("rejects an empty request", async () => {
    await connect();
    expect((await write({})).status).toBe(400);
  });
});
