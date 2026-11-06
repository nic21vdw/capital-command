import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
  vi.resetModules();
});

afterEach(() => vi.unstubAllEnvs());

const start = async (path = "/api/auth/linkedin") => {
  const { GET } = await import("./route");
  return GET(new NextRequest(`http://localhost:3000${path}`));
};

describe("GET /api/auth/linkedin", () => {
  it("sends the browser to LinkedIn's consent screen with the callback as the return address", async () => {
    const response = await start();
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/linkedin/callback");
    expect(location.searchParams.get("scope")).toBe("openid profile w_member_social");
  });

  it("asks for the page scopes on request", async () => {
    const location = new URL((await start("/api/auth/linkedin?pages=1")).headers.get("location")!);
    expect(location.searchParams.get("scope")).toContain("w_organization_social");
  });

  it("goes back to Settings with the setup message while the app credentials are not set", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    const response = await start();
    const location = new URL(response.headers.get("location")!, "http://localhost:3000");
    expect(location.pathname).toBe("/settings");
    expect(location.hash).toBe("#accounts");
    expect(location.searchParams.get("connect")).toBe("linkedin");
    expect(location.searchParams.get("connect_error")).toBe("Add the LinkedIn client ID and secret in Settings > Accounts first.");
  });
});
