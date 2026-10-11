import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "./connections";
import { YOUTUBE_RECOMMENDATION, buildGetStarted, connectionStatus, redirectUriNote } from "./getStarted";

const phase = { loaded: true, loadFailed: false };
const empty = { present: {}, connected: {} };
const connection = (id: string) => CONNECTIONS.find((entry) => entry.id === id)!;

describe("connectionStatus", () => {
  it("walks a sign-in platform from nothing to connected", () => {
    const youtube = connection("youtube");
    expect(connectionStatus(youtube, empty, phase)).toBe("Not set up");
    expect(connectionStatus(youtube, { present: { YOUTUBE_CLIENT_ID: true }, connected: {} }, phase)).toBe("Finish setup");
    const saved = { present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true }, connected: {} };
    expect(connectionStatus(youtube, saved, phase)).toBe("Sign in needed");
    expect(connectionStatus(youtube, { ...saved, connected: { youtube: true } }, phase)).toBe("Connected");
  });

  it("never calls a pasted token connected", () => {
    const instagram = connection("instagram");
    const saved = { present: { IG_USER_ID: true, IG_ACCESS_TOKEN: true }, connected: { instagram: true } };
    expect(connectionStatus(instagram, saved, phase)).toBe("Connected"); // only if the API says so
    expect(connectionStatus(instagram, { ...saved, connected: {} }, phase)).toBe("Saved - not verified");
  });

  it("says Checking and Unavailable before there is an answer", () => {
    expect(connectionStatus(connection("youtube"), empty, { loaded: false, loadFailed: false })).toBe("Checking");
    expect(connectionStatus(connection("youtube"), empty, { loaded: true, loadFailed: true })).toBe("Unavailable");
  });
});

describe("buildGetStarted", () => {
  it("puts YouTube first and recommends it on a fresh install", () => {
    const plan = buildGetStarted(empty, phase);
    expect(plan.items[0]).toMatchObject({ id: "youtube", status: "Not set up", recommended: true });
    expect(plan.items.map((item) => item.id).sort()).toEqual(CONNECTIONS.map((entry) => entry.id).sort());
    expect(plan.setUp).toBe(false);
    expect(plan.headline).toBe(YOUTUBE_RECOMMENDATION);
    expect(plan.items.every((item) => item.step.length > 0)).toBe(true);
  });

  it("names what is still missing on a half-finished platform", () => {
    const plan = buildGetStarted({ present: { TIKTOK_CLIENT_KEY: true }, connected: {} }, phase);
    expect(plan.items.find((item) => item.id === "tiktok")?.step).toBe("Still missing: client secret.");
  });

  it("says you're set up once one platform is connected, and stops recommending YouTube", () => {
    const state = { present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true }, connected: { youtube: true } };
    const plan = buildGetStarted(state, phase);
    expect(plan.setUp).toBe(true);
    expect(plan.connectedLabels).toEqual(["YouTube"]);
    expect(plan.headline).toContain("You're set up");
    expect(plan.items[0].recommended).toBe(false);
  });

  it("does not claim set up from saved-but-unverified credentials", () => {
    const state = { present: { THREADS_ACCESS_TOKEN: true }, connected: {} };
    expect(buildGetStarted(state, phase).setUp).toBe(false);
  });
});

describe("redirectUriNote", () => {
  const uri = "http://localhost:3100/api/auth/google/callback";

  it("says to register exactly the address shown when the page is on the same host", () => {
    expect(redirectUriNote("youtube", uri, "http://localhost:3100")).toMatch(/Register exactly this address/);
  });

  it("explains a localhost address when the app was opened at 127.0.0.1", () => {
    const note = redirectUriNote("youtube", uri, "http://127.0.0.1:3100") ?? "";
    expect(note).toBe(
      "Register this exact address in the Google Cloud console. It says localhost even though you opened the app at 127.0.0.1 - that's expected."
    );
    expect(redirectUriNote("tiktok", "http://localhost:3100/x", "http://127.0.0.1:3100")).toContain("in the TikTok console.");
  });

  it("names both hosts when the address bar differs from what the app sends otherwise", () => {
    const note = redirectUriNote("youtube", uri, "http://192.168.1.5:3100") ?? "";
    expect(note).toContain("192.168.1.5:3100");
    expect(note).toContain("localhost:3100");
    expect(note).toMatch(/Register the address above/);
  });

  it("leaves Spotify to its own note, and tolerates a missing browser origin or a bad URI", () => {
    expect(redirectUriNote("spotify", "http://127.0.0.1:3100/api/auth/spotify/callback", "http://localhost:3100")).toBeNull();
    expect(redirectUriNote("tiktok", "http://localhost:3100/x", null)).toMatch(/Register exactly/);
    expect(redirectUriNote("youtube", "not a url", "http://localhost:3100")).toBeNull();
  });
});
