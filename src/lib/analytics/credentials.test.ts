import { afterEach, describe, expect, it, vi } from "vitest";
import { liveCredentials } from "@/lib/analytics/credentials";
import { TIKTOK_SCOPE } from "@/lib/publisher/tiktokAuth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("liveCredentials", () => {
  it("has no Instagram or Facebook session until their tokens are configured", async () => {
    const credentials = liveCredentials();

    expect(await credentials.instagram("instagram-primary")).toBeNull();
    expect(await credentials.facebook("facebook-primary")).toBeNull();
  });

  it("builds the Instagram and Facebook sessions from the configured tokens and Graph version", async () => {
    vi.stubEnv("IG_USER_ID", "1784");
    vi.stubEnv("IG_ACCESS_TOKEN", "ig-secret");
    vi.stubEnv("IG_GRAPH_API_VERSION", "v24.0");
    vi.stubEnv("FB_PAGE_ID", "1000");
    vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-secret");

    const credentials = liveCredentials();

    expect(await credentials.instagram("instagram-primary")).toEqual({ token: "ig-secret", graphBase: "https://graph.facebook.com/v24.0" });
    expect(await credentials.facebook("facebook-primary")).toEqual({ token: "fb-secret", graphBase: "https://graph.facebook.com/v23.0" });
  });

  it("finds a Threads session by account id, using the refreshed token and the configured API base", async () => {
    vi.stubEnv("THREADS_ACCESS_TOKEN", "th-one");
    vi.stubEnv("THREADS_ACCESS_TOKEN_2", "th-two");

    const credentials = liveCredentials();

    expect(await credentials.threads("secondary")).toEqual({ token: "th-two", base: "https://graph.threads.net/v1.0" });
    expect(await credentials.threads("nobody")).toBeNull();
  });

  it("has no YouTube session when the account is not connected", async () => {
    expect(await liveCredentials().youtube("youtube-primary")).toBeNull();
  });

  it("reports the scopes the TikTok connect flow asks for", () => {
    expect(liveCredentials().tiktokScopes()).toBe(TIKTOK_SCOPE);
  });

  it("gives the same credential fingerprint the publisher's breaker uses", async () => {
    vi.stubEnv("THREADS_ACCESS_TOKEN", "th-one");
    const { threadsAccountFingerprint } = await import("@/lib/platform-health/fingerprint");

    expect(await liveCredentials().fingerprint("threads", "primary")).toBe(threadsAccountFingerprint({ accessToken: "th-one" }));
  });
});
