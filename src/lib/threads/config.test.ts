import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { threadsBlockedReason, threadsConfig, threadsConfigured, unassignedVersions } from "@/lib/threads/config";

const KEYS = [
  "THREADS_ENABLED",
  "THREADS_USER_ID",
  "THREADS_ACCESS_TOKEN",
  "THREADS_POSTS",
  "THREADS_LABEL",
  "THREADS_OFFSET_MINUTES",
  "THREADS_USER_ID_2",
  "THREADS_ACCESS_TOKEN_2",
  "THREADS_POSTS_2",
  "THREADS_LABEL_2",
  "THREADS_OFFSET_MINUTES_2",
  "THREADS_POSTS_PER_DAY",
  "THREADS_TIMEZONE",
  "PUBLISH_TIMEZONE"
];

let saved: Record<string, string | undefined> = {};

function connectPrimary() {
  process.env.THREADS_USER_ID = "111";
  process.env.THREADS_ACCESS_TOKEN = "token-1";
}

function connectSecondary() {
  process.env.THREADS_USER_ID_2 = "222";
  process.env.THREADS_ACCESS_TOKEN_2 = "token-2";
}

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
    expect(config.accounts).toHaveLength(0);
    expect(threadsConfigured(config)).toBe(false);
    expect(threadsBlockedReason(config)).toContain("No Threads account is connected");
  });

  it("is ready once one account has both credentials", () => {
    connectPrimary();
    const config = threadsConfig();
    expect(config.accounts).toHaveLength(1);
    expect(threadsBlockedReason(config)).toBeNull();
  });

  it("connects on the token alone, leaving the id to be resolved from it", () => {
    process.env.THREADS_ACCESS_TOKEN = "token-1";
    const [primary] = threadsConfig().accounts;

    expect(primary).toMatchObject({ id: "primary", userId: null });
    expect(threadsBlockedReason(threadsConfig())).toBeNull();
  });

  it("ignores an account with an id but no token — it could never post", () => {
    connectPrimary();
    process.env.THREADS_USER_ID_2 = "222";
    expect(threadsConfig().accounts.map((account) => account.id)).toEqual(["primary"]);
  });

  it("gives the two accounts different versions and a stagger by default", () => {
    connectPrimary();
    connectSecondary();
    const [primary, secondary] = threadsConfig().accounts;

    expect(primary).toMatchObject({ id: "primary", posts: "text", offsetMinutes: 0 });
    expect(secondary).toMatchObject({ id: "secondary", posts: "variant", offsetMinutes: 3 });
  });

  it("lets an account be pointed at the other version", () => {
    connectPrimary();
    process.env.THREADS_POSTS = "variant";
    expect(threadsConfig().accounts[0].posts).toBe("variant");
  });

  it("falls back to the default version when the setting is nonsense", () => {
    connectPrimary();
    process.env.THREADS_POSTS = "sideways";
    expect(threadsConfig().accounts[0].posts).toBe("text");
  });

  it("uses the label for logs when one is given", () => {
    connectPrimary();
    process.env.THREADS_LABEL = "nic_vandewetering";
    expect(threadsConfig().accounts[0].label).toBe("nic_vandewetering");
  });

  it("reports being switched off ahead of missing credentials", () => {
    process.env.THREADS_ENABLED = "false";
    connectPrimary();
    expect(threadsBlockedReason(threadsConfig())).toContain("switched off");
  });

  it("flags a version no account is posting", () => {
    connectPrimary();
    expect(unassignedVersions(threadsConfig())).toEqual(["variant"]);
    connectSecondary();
    expect(unassignedVersions(threadsConfig())).toEqual([]);
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
