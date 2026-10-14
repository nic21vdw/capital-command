import { afterEach, describe, expect, it, vi } from "vitest";
import { ThrottledError, TransientError, PermanentError } from "@/lib/publisher/http";
import { isAuthFailure } from "@/lib/platform-health/auth";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";
import {
  LINKEDIN_COMMENTARY_LIMIT,
  linkedinCall,
  linkedinVersion,
  littleText,
  minutesUntilUtcReset,
  throttleMinutes
} from "@/lib/publisher/linkedinApi";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("littleText", () => {
  it("escapes the characters LinkedIn treats as markup so the post is not cut short", () => {
    expect(littleText("Shipped (finally) [v2] *fast* ~mostly~ a|b {x} <y>")).toBe(
      "Shipped \\(finally\\) \\[v2\\] \\*fast\\* \\~mostly\\~ a\\|b \\{x\\} \\<y\\>"
    );
  });

  it("escapes backslashes, underscores and mentions", () => {
    expect(littleText("a\\b snake_case @nic")).toBe("a\\\\b snake\\_case \\@nic");
  });

  it("turns hashtags into LinkedIn hashtag tokens", () => {
    expect(littleText("Built it #AI and #vibe_coding")).toBe("Built it {hashtag|\\#|AI} and {hashtag|\\#|vibe\\_coding}");
  });

  it("escapes a # that is not a hashtag, such as a link fragment", () => {
    expect(littleText("see https://colateralai.com/li#top")).toBe("see https://colateralai.com/li\\#top");
  });

  it("keeps the result inside LinkedIn's commentary limit", () => {
    const long = littleText("(".repeat(LINKEDIN_COMMENTARY_LIMIT));
    expect(long.length).toBeLessThanOrEqual(LINKEDIN_COMMENTARY_LIMIT);
    expect(long.endsWith("\\")).toBe(false);
  });
});

describe("linkedinVersion", () => {
  it("is a YYYYMM version and can be overridden", () => {
    expect(linkedinVersion()).toMatch(/^\d{6}$/);
    vi.stubEnv("LINKEDIN_API_VERSION", "202601");
    expect(linkedinVersion()).toBe("202601");
    vi.stubEnv("LINKEDIN_API_VERSION", "latest");
    expect(linkedinVersion()).toMatch(/^\d{6}$/);
  });
});

describe("the daily limit window", () => {
  it("waits until just after the next UTC midnight, when LinkedIn's daily limits reset", () => {
    expect(minutesUntilUtcReset(new Date("2026-10-13T23:00:00.000Z"))).toBe(65);
    expect(minutesUntilUtcReset(new Date("2026-10-13T00:00:00.000Z"))).toBe(24 * 60 + 5);
  });

  it("honours Retry-After when LinkedIn sends one", () => {
    const response = new Response("", { status: 429, headers: { "Retry-After": "600" } });
    expect(throttleMinutes(response, new Date("2026-10-13T12:00:00.000Z"))).toBe(10);
  });

  it("falls back to the daily reset without it", () => {
    const response = new Response("", { status: 429 });
    expect(throttleMinutes(response, new Date("2026-10-13T22:00:00.000Z"))).toBe(125);
  });
});

describe("linkedinCall error mapping", () => {
  const call = () => linkedinCall("https://api.linkedin.com/rest/posts", { method: "POST", token: "t", label: "LinkedIn post", body: {} });

  it("sends the versioned headers", async () => {
    const requests = mockFetchRoutes([{ match: "/rest/posts", respond: () => jsonResponse({}) }]);
    await call();
    expect(requests[0].headers).toMatchObject({
      Authorization: "Bearer t",
      "LinkedIn-Version": linkedinVersion(),
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json"
    });
  });

  it("maps 429 to a throttle that defers instead of burning attempts", async () => {
    mockFetchRoutes([{ match: "/rest/posts", respond: () => new Response("quota", { status: 429, headers: { "Retry-After": "300" } }) }]);
    const error = await call().catch((caught) => caught);
    expect(error).toBeInstanceOf(ThrottledError);
    expect((error as ThrottledError).retryAfterMinutes).toBe(5);
    expect((error as Error).message).toContain("HTTP 429");
  });

  it.each([500, 502, 503, 504, 408])("maps %i to a retryable error", async (status) => {
    mockFetchRoutes([{ match: "/rest/posts", respond: () => new Response("down", { status }) }]);
    const error = await call().catch((caught) => caught);
    expect(error).toBeInstanceOf(TransientError);
    expect(error).not.toBeInstanceOf(ThrottledError);
  });

  it("maps a dropped connection to a retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const error = await call().catch((caught) => caught);
    expect(error).toBeInstanceOf(TransientError);
    expect((error as Error).message).toContain("network error");
  });

  it("maps 401 to a permanent error the auth breaker recognises", async () => {
    mockFetchRoutes([{ match: "/rest/posts", respond: () => jsonResponse({ code: "REVOKED_ACCESS_TOKEN", message: "The token used in the request has been revoked by the user." }, { status: 401 }) }]);
    const error = await call().catch((caught) => caught);
    expect(error).toBeInstanceOf(PermanentError);
    expect(isAuthFailure(error)).toBe(true);
  });

  it("keeps 403 and 422 permanent and out of the auth breaker", async () => {
    for (const status of [403, 422, 400, 404]) {
      mockFetchRoutes([{ match: "/rest/posts", respond: () => jsonResponse({ message: "nope" }, { status }) }]);
      const error = await call().catch((caught) => caught);
      expect(error).toBeInstanceOf(PermanentError);
      expect(isAuthFailure(error)).toBe(false);
    }
  });
});
