import { describe, expect, it } from "vitest";
import type { PublisherConfig } from "./config";
import { connectErrorUrl, missingCredentialsMessage, oauthCredentialsMissing, redirectWithinApp } from "./connectStart";

const config = (patch: Partial<Record<"youtube" | "tiktok" | "spotify", Record<string, string | null>>>) =>
  ({
    youtube: { clientId: "id", clientSecret: "secret", ...patch.youtube },
    tiktok: { clientKey: "key", clientSecret: "secret", ...patch.tiktok },
    spotify: { clientId: "id", clientSecret: "secret", ...patch.spotify }
  }) as unknown as PublisherConfig;

describe("starting a sign-in before the app credentials are saved", () => {
  it("names Settings, not .env", () => {
    expect(missingCredentialsMessage("youtube")).toBe("Add the YouTube client ID and secret in Settings > Accounts first.");
    expect(missingCredentialsMessage("tiktok")).toContain("Settings > Accounts");
    expect(missingCredentialsMessage("spotify")).not.toMatch(/\.env/);
  });

  it("is missing when either half is absent", () => {
    expect(oauthCredentialsMissing("youtube", config({}))).toBe(false);
    expect(oauthCredentialsMissing("youtube", config({ youtube: { clientSecret: null } }))).toBe(true);
    expect(oauthCredentialsMissing("tiktok", config({ tiktok: { clientKey: null } }))).toBe(true);
    expect(oauthCredentialsMissing("spotify", config({ spotify: { clientId: null } }))).toBe(true);
  });

  it("redirects to the Accounts section of Settings with the toast message and the row to open", () => {
    const url = connectErrorUrl("http://localhost:3000", "youtube", missingCredentialsMessage("youtube"));
    expect(url.pathname).toBe("/settings");
    expect(url.hash).toBe("#accounts");
    expect(url.searchParams.get("connect_error")).toBe("Add the YouTube client ID and secret in Settings > Accounts first.");
    expect(url.searchParams.get("connect")).toBe("youtube");
  });
});

describe("redirectWithinApp", () => {
  it("answers with a relative Location so the origin the page was opened at is kept", () => {
    // The server believes it is localhost; the person opened 127.0.0.1.
    const response = redirectWithinApp(connectErrorUrl("http://localhost:3100", "youtube", "Add the keys"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("/settings?connect_error=Add+the+keys&connect=youtube#accounts");
    expect(new URL(location, "http://127.0.0.1:3100").origin).toBe("http://127.0.0.1:3100");
  });
});
