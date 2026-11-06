import { describe, expect, it } from "vitest";
import {
  CONNECT_FAILURE_KEY,
  clearConnectFailure,
  connectErrorMessage,
  explainConnectError,
  readConnectFailures,
  rememberConnectFailure
} from "./connectErrors";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(CONNECT_FAILURE_KEY, initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  };
}

describe("explainConnectError", () => {
  it("turns access_denied into a cancelled-sign-in message", () => {
    const result = explainConnectError("access_denied", "youtube");
    expect(result.kind).toBe("denied");
    expect(result.summary).toMatch(/cancelled|not granted/);
    expect(result.summary).toContain("YouTube");
    expect(result.raw).toBe("access_denied");
  });

  it("reads TikTok's human-written denial the same way", () => {
    expect(explainConnectError("The user denied the authorization request", "tiktok").kind).toBe("denied");
  });

  it("reads LinkedIn's cancelled authorization as a cancelled sign-in", () => {
    const result = explainConnectError("The user cancelled the authorization", "linkedin");
    expect(result.kind).toBe("denied");
    expect(result.summary).toContain("LinkedIn");
  });

  it("does not read a cancellation as a cancelled sign-in on any other platform", () => {
    for (const platform of ["youtube", "tiktok", "spotify", "instagram", undefined]) {
      expect(explainConnectError("The request was cancelled by the server", platform).kind).toBe("unknown");
    }
  });

  it("mentions the Google verification step only for YouTube", () => {
    const youtube = explainConnectError("access_denied", "youtube").fix;
    expect(youtube).toContain("If Google says the app is unverified");
    expect(youtube).toContain("test user");
  });

  it("gives TikTok its own sandbox-mode step, never the Google one", () => {
    const tiktok = explainConnectError("access_denied", "tiktok").fix;
    expect(tiktok).toContain("If TikTok says the app is in sandbox mode, add your account as a test user in the TikTok developer portal.");
    expect(tiktok).not.toContain("unverified");
    expect(tiktok).not.toContain("Google");
  });

  it("omits the platform-specific step for Spotify", () => {
    const spotify = explainConnectError("access_denied", "spotify").fix;
    expect(spotify).toBe("Try again and approve every permission Spotify asks for.");
  });

  it("explains a redirect mismatch and points at the redirect URI in the row", () => {
    const result = explainConnectError('Google OAuth code exchange failed: 400 {"error":"redirect_uri_mismatch"}', "youtube");
    expect(result.kind).toBe("redirect-mismatch");
    expect(result.fix).toContain("redirect URI");
  });

  it("explains invalid_client as a wrong client id or secret", () => {
    const result = explainConnectError('failed: 401 {"error":"invalid_client"}', "youtube");
    expect(result.kind).toBe("bad-client");
    expect(result.fix).toMatch(/client ID|secret/);
  });

  it("explains missing credentials from the start routes and from a late check", () => {
    expect(explainConnectError("Add the YouTube client ID and secret in Settings > Accounts first.", "youtube").kind).toBe("missing-credentials");
    expect(explainConnectError("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not configured.", "youtube").kind).toBe("missing-credentials");
  });

  it("explains a used or expired code and a missing refresh token", () => {
    expect(explainConnectError("invalid_grant", "tiktok").kind).toBe("bad-grant");
    const noRefresh = explainConnectError("Google returned no refresh token. Remove the app's access", "youtube");
    expect(noRefresh.kind).toBe("no-refresh-token");
    expect(noRefresh.fix).toContain("myaccount.google.com/permissions");
    expect(explainConnectError("Google returned no authorization code.", "youtube").kind).toBe("expired");
  });

  it("passes an unknown message through instead of guessing", () => {
    const result = explainConnectError("Something odd happened", "spotify");
    expect(result.kind).toBe("unknown");
    expect(result.fix).toContain("Something odd happened");
  });

  it("still answers when the platform is unknown", () => {
    expect(connectErrorMessage("access_denied")).toContain("the provider");
  });
});

describe("remembering a failure", () => {
  it("keeps it per platform until it is cleared", () => {
    const storage = memoryStorage();
    rememberConnectFailure("youtube", "access_denied", storage, new Date("2026-10-10T12:00:00Z"));
    rememberConnectFailure("tiktok", "invalid_client", storage);
    expect(Object.keys(readConnectFailures(storage)).sort()).toEqual(["tiktok", "youtube"]);
    expect(readConnectFailures(storage).youtube).toEqual({ raw: "access_denied", at: "2026-10-10T12:00:00.000Z" });

    clearConnectFailure("youtube", storage);
    expect(Object.keys(readConnectFailures(storage))).toEqual(["tiktok"]);
  });

  it("a later failure replaces the earlier one", () => {
    const storage = memoryStorage();
    rememberConnectFailure("youtube", "access_denied", storage);
    rememberConnectFailure("youtube", "invalid_client", storage);
    expect(readConnectFailures(storage).youtube.raw).toBe("invalid_client");
  });

  it("survives corrupt, hostile or missing storage", () => {
    expect(readConnectFailures(memoryStorage("{not json"))).toEqual({});
    expect(readConnectFailures(memoryStorage("[1,2]"))).toEqual({});
    expect(readConnectFailures(memoryStorage(JSON.stringify({ nope: { raw: "x" }, youtube: { raw: 5 } })))).toEqual({});
    expect(readConnectFailures(null)).toEqual({});
    expect(() => rememberConnectFailure("youtube", "x", null)).not.toThrow();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readConnectFailures(throwing)).toEqual({});
    expect(() => clearConnectFailure("youtube", throwing)).not.toThrow();
  });
});
