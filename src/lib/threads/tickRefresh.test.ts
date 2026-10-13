import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { threadsConfig } from "@/lib/threads/config";
import { threadsTick } from "@/lib/threads/daily";

const mocks = vi.hoisted(() => ({ runDue: vi.fn() }));
vi.mock("@/lib/threads/runner", () => ({ runDue: mocks.runDue }));
vi.mock("@/lib/x-posts/daily", () => ({ ensureDailyPack: vi.fn(async ({ date }: { date: string }) => ({ pack: { source: "test", date, posts: [] }, cached: true })) }));
vi.mock("@/lib/automations/store", () => ({
  recordAutomationOutcome: vi.fn(async () => undefined),
  isAutomationPaused: vi.fn(async () => false)
}));

const now = new Date("2026-10-13T15:00:00Z");

function stubRefresh(token: string) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 5_184_000 }), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function tick(options: { refreshTokens?: boolean; dryRun?: boolean } = {}) {
  return threadsTick({ now, config: { ...threadsConfig(), enabled: false }, log: () => undefined, ...options });
}

beforeEach(async () => {
  await rm(dataPath("threads-tokens.json"), { force: true });
  mocks.runDue.mockReset().mockResolvedValue({
    ran: now.toISOString(), published: 0, failed: 0, skipped: 0, outcomes: [], dryRun: false
  });
  vi.stubEnv("THREADS_ACCESS_TOKEN", "env-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the scheduled Threads tick refreshes tokens", () => {
  it("renews a due token before posting and hands the renewed one to the runner", async () => {
    const fetchMock = stubRefresh("refreshed-1");

    const result = await tick({ refreshTokens: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.tokens).toEqual([expect.objectContaining({ accountId: "primary", outcome: "refreshed" })]);
    const [, options] = mocks.runDue.mock.calls[0] as [Date, { config: { accounts: Array<{ accessToken: string }> } }];
    expect(options.config.accounts[0].accessToken).toBe("refreshed-1");
  });

  it("does not ask Meta again on the next tick inside the week", async () => {
    stubRefresh("refreshed-1");
    await tick({ refreshTokens: true });
    const fetchMock = stubRefresh("refreshed-2");

    const result = await threadsTick({
      now: new Date(now.getTime() + 60 * 60 * 1000),
      config: { ...threadsConfig(), enabled: false },
      log: () => undefined,
      refreshTokens: true
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.tokens).toBeUndefined();
  });

  it("leaves tokens alone for a tick that did not ask, and for a dry run", async () => {
    const fetchMock = stubRefresh("refreshed-1");

    await tick();
    await tick({ refreshTokens: true, dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
