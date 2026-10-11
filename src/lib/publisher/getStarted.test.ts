import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "./connections";
import {
  YOUTUBE_CONSOLE_STEPS,
  splitConsoleStep,
  walkthroughShowsRedirectUri,
  YOUTUBE_CONSOLE_URL,
  YOUTUBE_RECOMMENDATION,
  YOUTUBE_WHY,
  buildGetStarted,
  connectionProgress,
  connectionStatus,
  redirectUriNote,
  youtubeChecklist
} from "./getStarted";

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

describe("youtubeChecklist", () => {
  const ids = (list: ReturnType<typeof youtubeChecklist>) => list.steps.map((step) => step.done);

  it("starts at the first step on a fresh install", () => {
    const list = youtubeChecklist(empty, phase);
    expect(list.total).toBe(4);
    expect(list.done).toBe(0);
    expect(list.steps[0]).toMatchObject({ id: "create-client", current: true });
    expect(list.steps.filter((step) => step.current)).toHaveLength(1);
  });

  it("infers the client from a saved ID and moves to the secret", () => {
    const list = youtubeChecklist({ present: { YOUTUBE_CLIENT_ID: true }, connected: {} }, phase);
    expect(ids(list)).toEqual([true, true, false, false]);
    expect(list.steps.find((step) => step.current)?.id).toBe("client-secret");
  });

  it("points at sign-in once both credentials are saved", () => {
    const list = youtubeChecklist({ present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true }, connected: {} }, phase);
    expect(list.done).toBe(3);
    expect(list.steps.find((step) => step.current)?.id).toBe("sign-in");
    expect(list.complete).toBe(false);
  });

  it("is complete only when the sign-in is confirmed, and has no current step then", () => {
    const list = youtubeChecklist(
      { present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true }, connected: { youtube: true } },
      phase
    );
    expect(list.complete).toBe(true);
    expect(list.steps.some((step) => step.current)).toBe(false);
  });

  it("does not count a sign-in whose credentials are gone", () => {
    const list = youtubeChecklist({ present: {}, connected: { youtube: true } }, phase);
    expect(list.steps[3].done).toBe(false);
  });

  it("claims no progress before the state has loaded or when it could not", () => {
    const saved = { present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true }, connected: { youtube: true } };
    expect(youtubeChecklist(saved, { loaded: false, loadFailed: false }).done).toBe(0);
    expect(youtubeChecklist(saved, { loaded: true, loadFailed: true }).done).toBe(0);
  });
});

describe("connectionProgress", () => {
  it("counts against every row the page lists", () => {
    const progress = connectionProgress(empty, phase);
    expect(progress).toMatchObject({ connected: 0, total: CONNECTIONS.length, savedNotVerified: 0, line: `0 of ${CONNECTIONS.length} connected` });
  });

  it("counts a signed-in platform and reports saved tokens separately", () => {
    const progress = connectionProgress(
      {
        present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true, THREADS_ACCESS_TOKEN: true },
        connected: { youtube: true }
      },
      phase
    );
    expect(progress.connected).toBe(1);
    expect(progress.savedNotVerified).toBe(1);
    expect(progress.line).toBe(`1 of ${CONNECTIONS.length} connected - 1 saved, not verified`);
  });

  it("says nothing is connected while the state is unknown", () => {
    expect(connectionProgress({ present: {}, connected: { youtube: true } }, { loaded: false, loadFailed: false }).connected).toBe(0);
  });
});

describe("YouTube setup walkthrough", () => {
  it("says why a Google client is needed in one plain line", () => {
    expect(YOUTUBE_WHY).toMatch(/^YouTube asks every app to use its own Google sign-in key\./);
    expect(YOUTUBE_WHY).not.toMatch(/[\u2013\u2014]/); // no dashes in UI copy
  });

  it("walks the Google console in three to four plain steps, naming what to enable and create", () => {
    expect(YOUTUBE_CONSOLE_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(YOUTUBE_CONSOLE_STEPS.length).toBeLessThanOrEqual(4);
    // Testing mode expires the sign-in after 7 days, which reads as the app breaking.
    expect(YOUTUBE_CONSOLE_STEPS.join(" ")).toContain("Publish app");
    const text = YOUTUBE_CONSOLE_STEPS.join(" ");
    expect(text).toContain("YouTube Data API v3");
    expect(text).toContain("Web application");
    expect(text).toContain("Authorized redirect URIs");
    expect(YOUTUBE_CONSOLE_URL).toBe("https://console.cloud.google.com/");
  });

  it("points the create-client step at the walkthrough instead of repeating it", () => {
    const step = youtubeChecklist(empty, phase).steps[0];
    expect(step.current).toBe(true);
    expect(step.detail).toMatch(/four steps/);
  });
});

describe("splitConsoleStep", () => {
  it("keeps the first sentence as the lead and the rest as detail", () => {
    const [, , consent] = YOUTUBE_CONSOLE_STEPS;
    const { lead, rest } = splitConsoleStep(consent);
    expect(lead).toBe("Go to APIs & Services > OAuth consent screen.");
    expect(rest).toContain("Publish app");
    expect(`${lead} ${rest}`).toBe(consent);
  });

  it("leaves a one-sentence step whole", () => {
    expect(splitConsoleStep("Open the console.")).toEqual({ lead: "Open the console.", rest: "" });
  });
});

describe("walkthroughShowsRedirectUri", () => {
  it("is on only while step 1 is the current step and the state is known", () => {
    expect(walkthroughShowsRedirectUri(youtubeChecklist(empty, phase), true)).toBe(true);
    expect(walkthroughShowsRedirectUri(youtubeChecklist(empty, phase), false)).toBe(false);
  });

  it("is off once the client exists, so the card shows the address instead", () => {
    const withClient = { present: { YOUTUBE_CLIENT_ID: true, YOUTUBE_CLIENT_SECRET: true }, connected: {} };
    expect(walkthroughShowsRedirectUri(youtubeChecklist(withClient, phase), true)).toBe(false);
    const done = { ...withClient, connected: { youtube: true } };
    expect(walkthroughShowsRedirectUri(youtubeChecklist(done, phase), true)).toBe(false);
  });
});
