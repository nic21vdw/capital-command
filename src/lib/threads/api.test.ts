import { afterEach, describe, expect, it, vi } from "vitest";
import { accountUserId } from "@/lib/threads/api";
import type { ThreadsAccount, ThreadsConfig } from "@/lib/threads/config";

function config(): ThreadsConfig {
  return {
    enabled: true,
    accounts: [],
    apiBase: "https://graph.threads.net",
    apiVersion: "v1.0",
    timezone: "UTC",
    postsPerDay: 24,
    lateGraceMinutes: 45,
    maxAttempts: 4,
    backoffBaseMinutes: 5,
    backoffCapMinutes: 60,
    claimTimeoutMinutes: 10,
    retentionDays: 14,
    planAheadHour: 21,
    catchUp: true,
    catchUpMinGapMinutes: 20,
    catchUpMinShortfall: 2,
    catchUpCooldownMinutes: 60
  };
}

let tokenCounter = 0;

function account(overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  tokenCounter += 1;
  return {
    id: "primary",
    label: "primary",
    userId: null,
    // A fresh token per account keeps the resolved-id cache from leaking
    // between tests.
    accessToken: `token-${tokenCounter}`,
    posts: "text",
    offsetMinutes: 0,
    ...overrides
  };
}

function stubFetch(id: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id, username: "someone" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("accountUserId", () => {
  it("uses the configured id without calling out", async () => {
    const fetchMock = stubFetch("999");

    await expect(accountUserId(account({ userId: "12345" }), config())).resolves.toBe("12345");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the id from the token when none is configured", async () => {
    stubFetch("777");
    await expect(accountUserId(account(), config())).resolves.toBe("777");
  });

  it("looks a token up once and reuses the answer", async () => {
    const fetchMock = stubFetch("555");
    const connected = account();

    await accountUserId(connected, config());
    await accountUserId(connected, config());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the token in the URL", async () => {
    const fetchMock = stubFetch("321");
    const connected = account({ accessToken: "super-secret-token" });

    await accountUserId(connected, config());

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain("super-secret-token");
  });
});
