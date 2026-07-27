import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { threadsBlockedReason, threadsConfig, threadsConfigured } from "@/lib/threads/config";

const KEYS = [
  "THREADS_ENABLED",
  "THREADS_USER_ID",
  "THREADS_ACCESS_TOKEN",
  "THREADS_SECOND_POST",
  "THREADS_POSTS_PER_DAY",
  "THREADS_TIMEZONE",
  "PUBLISH_TIMEZONE"
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("threadsConfig", () => {
  it("defaults to on but unconnected, so nothing posts until a token is pasted in", () => {
    const config = threadsConfig();
    expect(config.enabled).toBe(true);
    expect(threadsConfigured(config)).toBe(false);
    expect(threadsBlockedReason(config)).toContain("not connected");
  });

  it("is ready once both credentials are set", () => {
    process.env.THREADS_USER_ID = "12345";
    process.env.THREADS_ACCESS_TOKEN = "token";
    expect(threadsBlockedReason(threadsConfig())).toBeNull();
  });

  it("reports being switched off ahead of missing credentials", () => {
    process.env.THREADS_ENABLED = "false";
    process.env.THREADS_USER_ID = "12345";
    process.env.THREADS_ACCESS_TOKEN = "token";
    expect(threadsBlockedReason(threadsConfig())).toContain("switched off");
  });

  it("posts the second version as a reply unless told otherwise", () => {
    expect(threadsConfig().secondPost).toBe("reply");
    process.env.THREADS_SECOND_POST = "standalone";
    expect(threadsConfig().secondPost).toBe("standalone");
    process.env.THREADS_SECOND_POST = "nonsense";
    expect(threadsConfig().secondPost).toBe("reply");
  });

  it("falls back to the publisher's timezone before its own default", () => {
    process.env.PUBLISH_TIMEZONE = "Europe/Berlin";
    expect(threadsConfig().timezone).toBe("Europe/Berlin");
    process.env.THREADS_TIMEZONE = "America/Vancouver";
    expect(threadsConfig().timezone).toBe("America/Vancouver");
  });

  it("caps the daily volume", () => {
    process.env.THREADS_POSTS_PER_DAY = "500";
    expect(threadsConfig().postsPerDay).toBe(48);
  });
});
