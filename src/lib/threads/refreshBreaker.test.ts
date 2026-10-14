import { rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/platforms/route";
import { dataPath } from "@/lib/paths";
import { readAuthStates } from "@/lib/platform-health/store";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";
import { threadsConfig } from "@/lib/threads/config";
import { threadsTick } from "@/lib/threads/daily";
import { hashToken, refreshThreadsTokens } from "@/lib/threads/tokens";

const mocks = vi.hoisted(() => ({ runDue: vi.fn() }));
vi.mock("@/lib/threads/runner", () => ({ runDue: mocks.runDue }));
vi.mock("@/lib/x-posts/daily", () => ({
  ensureDailyPack: vi.fn(async ({ date }: { date: string }) => ({ pack: { source: "test", date, posts: [] }, cached: true }))
}));
vi.mock("@/lib/automations/store", () => ({
  recordAutomationOutcome: vi.fn(async () => undefined),
  isAutomationPaused: vi.fn(async () => false)
}));

const EXPIRED_401 =
  '{"error":{"message":"Error validating access token: Session has expired on Thursday, 24-Sep-26 20:13:48 PDT. The current time is Tuesday, 13-Oct-26 11:02:11 PDT.","type":"OAuthException","code":190,"error_subcode":463,"fbtrace_id":"AbC123"}}';

const NOW = new Date("2026-10-13T15:00:00.000Z");
const HOUR = 3_600_000;

function respond(status: number, body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function refreshed(token: string) {
  return respond(200, JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 5_184_000 }));
}

function tick(now: Date = NOW) {
  return threadsTick({ now, config: { ...threadsConfig(), enabled: false }, log: () => undefined, refreshTokens: true });
}

async function health(): Promise<PlatformHealthResponse> {
  return (await GET()).json() as Promise<PlatformHealthResponse>;
}

beforeEach(async () => {
  await rm(dataPath("threads-tokens.json"), { force: true });
  await rm(dataPath("platform-auth.json"), { force: true });
  mocks.runDue.mockReset().mockResolvedValue({
    ran: NOW.toISOString(), published: 0, failed: 0, skipped: 0, outcomes: [], dryRun: false
  });
  vi.stubEnv("THREADS_ACCESS_TOKEN", "env-token");
  vi.stubEnv("THREADS_LABEL", "nic_vandewetering");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a rejected Threads token refresh trips the auth breaker", () => {
  it("lists the account as broken when the tick's refresh gets the expired-session 401 and no post is due", async () => {
    respond(401, EXPIRED_401);

    const result = await tick();

    expect(result.tokens).toEqual([expect.objectContaining({ accountId: "primary", outcome: "failed" })]);
    expect(mocks.runDue).toHaveBeenCalledTimes(1);
    expect(result.run).toMatchObject({ published: 0, failed: 0, outcomes: [] });
    expect(await health()).toMatchObject({
      ok: false,
      broken: [
        expect.objectContaining({
          platform: "threads",
          accountId: "primary",
          displayName: "Threads · nic_vandewetering",
          since: NOW.toISOString(),
          reason: expect.stringContaining("Session has expired"),
          fixUrl: "/settings#accounts"
        })
      ]
    });
  });

  it("states the reason without the token and keeps the break date across later failures", async () => {
    respond(401, EXPIRED_401);
    await tick();
    const later = new Date(NOW.getTime() + 7 * HOUR);
    respond(401, EXPIRED_401);
    await tick(later);

    const [entry] = (await health()).broken;

    expect(entry.since).toBe(NOW.toISOString());
    expect(entry.reason).not.toContain("env-token");
    expect(JSON.stringify(await health())).not.toContain("env-token");
  });

  it("trips on Meta error code 190 whatever the status line says", async () => {
    respond(400, EXPIRED_401);

    await tick();

    expect((await health()).broken.map((entry) => entry.accountId)).toEqual(["primary"]);
  });

  it("shows the account straight away when the failed refresh was logged before this build and is still cooling off", async () => {
    await writeFile(
      dataPath("threads-tokens.json"),
      JSON.stringify({
        primary: {
          source: hashToken("env-token"),
          token: "",
          refreshedAt: "",
          expiresAt: null,
          lastErrorAt: new Date(NOW.getTime() - HOUR).toISOString(),
          lastError: `Threads token refresh (nic_vandewetering) failed (HTTP 401): ${EXPIRED_401}`
        }
      })
    );
    const fetchMock = respond(401, EXPIRED_401);

    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await health()).toMatchObject({
      ok: false,
      broken: [expect.objectContaining({ accountId: "primary", since: new Date(NOW.getTime() - HOUR).toISOString() })]
    });
  });

  it("does not stack failures or push the next trial back while the cooling-off refresh is skipped", async () => {
    respond(401, EXPIRED_401);
    await tick();
    const before = (await readAuthStates())["threads:primary"];

    await tick(new Date(NOW.getTime() + HOUR));
    await tick(new Date(NOW.getTime() + 2 * HOUR));

    expect((await readAuthStates())["threads:primary"]).toEqual(before);
  });

  it("does not flag a 5xx from Meta", async () => {
    respond(503, '{"error":{"message":"Service temporarily unavailable","code":2}}');

    const result = await tick();

    expect(result.tokens).toEqual([expect.objectContaining({ outcome: "failed" })]);
    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });

  it("does not flag a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const result = await tick();

    expect(result.tokens).toEqual([expect.objectContaining({ outcome: "failed", detail: expect.stringContaining("network error") })]);
    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });

  it("does not flag a refusal that is not about the token", async () => {
    respond(400, '{"error":{"message":"Cannot refresh a token younger than 24 hours","type":"OAuthException","code":100}}');

    await tick();

    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });

  it("clears the account when a later refresh succeeds", async () => {
    respond(401, EXPIRED_401);
    await tick();
    expect((await health()).ok).toBe(false);
    refreshed("refreshed-1");

    await tick(new Date(NOW.getTime() + 7 * HOUR));

    expect(await health()).toMatchObject({ ok: true, broken: [] });
    expect(await readAuthStates()).toEqual({});
  });

  it("clears the account when a new token is pasted into .env", async () => {
    respond(401, EXPIRED_401);
    await tick();
    expect((await health()).ok).toBe(false);

    vi.stubEnv("THREADS_ACCESS_TOKEN", "pasted-token");

    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });

  it("flags only the account whose refresh was rejected", async () => {
    vi.stubEnv("THREADS_ACCESS_TOKEN_2", "second-env-token");
    vi.stubEnv("THREADS_LABEL_2", "second_handle");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const bearer = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return bearer === "Bearer env-token"
        ? new Response(EXPIRED_401, { status: 401 })
        : new Response(JSON.stringify({ access_token: "refreshed-2", expires_in: 5_184_000 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshThreadsTokens(
      threadsConfig(),
      { primary: "env-token", secondary: "second-env-token" },
      NOW
    );

    expect((await health()).broken.map((entry) => entry.displayName)).toEqual(["Threads · nic_vandewetering"]);
  });
});
