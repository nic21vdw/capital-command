import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { effectiveToken, hashToken, readStoredTokens, refreshThreadsTokens } from "@/lib/threads/tokens";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;

function connect(token = "env-token") {
  vi.stubEnv("THREADS_ACCESS_TOKEN", token);
  return threadsConfig();
}

function stubRefresh(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function ok(token: string) {
  return () => new Response(JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 5_184_000 }), { status: 200 });
}

beforeEach(async () => {
  await rm(dataPath("threads-tokens.json"), { force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function refresh(config: ThreadsConfig, now = NOW) {
  return refreshThreadsTokens(config, { primary: process.env.THREADS_ACCESS_TOKEN! }, now);
}

describe("Threads token refresh", () => {
  it("refreshes a token it has never refreshed, and the config then uses the new one", async () => {
    const fetchMock = stubRefresh(ok("refreshed-1"));
    const outcomes = await refresh(connect());

    expect(outcomes).toEqual([expect.objectContaining({ accountId: "primary", outcome: "refreshed" })]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token");
    expect(url).not.toContain("env-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer env-token");
    expect(threadsConfig().accounts[0].accessToken).toBe("refreshed-1");
  });

  it("does not ask again inside the refresh interval", async () => {
    stubRefresh(ok("refreshed-1"));
    await refresh(connect());
    const fetchMock = stubRefresh(ok("refreshed-2"));

    const outcomes = await refresh(threadsConfig(), new Date(NOW.getTime() + 3 * DAY));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcomes[0].outcome).toBe("fresh");
  });

  it("refreshes the refreshed token once the interval has passed", async () => {
    stubRefresh(ok("refreshed-1"));
    await refresh(connect());
    const fetchMock = stubRefresh(ok("refreshed-2"));

    await refresh(threadsConfig(), new Date(NOW.getTime() + 8 * DAY));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer refreshed-1");
    expect(threadsConfig().accounts[0].accessToken).toBe("refreshed-2");
  });

  it("stores the renewed token with the expiry Meta reported", async () => {
    stubRefresh(ok("refreshed-1"));
    await refresh(connect());

    expect(readStoredTokens().primary).toMatchObject({
      token: "refreshed-1",
      source: hashToken("env-token"),
      refreshedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 5_184_000 * 1000).toISOString()
    });
  });

  it("renews on the seventh day and not a minute before", async () => {
    stubRefresh(ok("refreshed-1"));
    await refresh(connect());
    const early = stubRefresh(ok("refreshed-2"));

    await refresh(threadsConfig(), new Date(NOW.getTime() + 7 * DAY - 60_000));
    expect(early).not.toHaveBeenCalled();

    const due = stubRefresh(ok("refreshed-2"));
    await refresh(threadsConfig(), new Date(NOW.getTime() + 7 * DAY));
    expect(due).toHaveBeenCalledTimes(1);
  });

  it("follows THREADS_TOKEN_REFRESH_DAYS", async () => {
    vi.stubEnv("THREADS_TOKEN_REFRESH_DAYS", "2");
    stubRefresh(ok("refreshed-1"));
    await refresh(connect());
    const fetchMock = stubRefresh(ok("refreshed-2"));

    await refresh(threadsConfig(), new Date(NOW.getTime() + 3 * DAY));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a new token pasted into .env win over an old refresh", async () => {
    stubRefresh(ok("refreshed-1"));
    await refresh(connect());

    expect(connect("pasted-later").accounts[0].accessToken).toBe("pasted-later");
  });

  it("keeps posting with the current token when Meta refuses, and waits before retrying", async () => {
    stubRefresh(() => new Response(JSON.stringify({ error: { message: "Session has expired for env-token" } }), { status: 400 }));
    const outcomes = await refresh(connect());

    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].detail).not.toContain("env-token");
    expect(threadsConfig().accounts[0].accessToken).toBe("env-token");

    const fetchMock = stubRefresh(ok("refreshed-1"));
    await refresh(threadsConfig(), new Date(NOW.getTime() + 60 * 60 * 1000));
    expect(fetchMock).not.toHaveBeenCalled();

    await refresh(threadsConfig(), new Date(NOW.getTime() + 7 * 60 * 60 * 1000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(threadsConfig().accounts[0].accessToken).toBe("refreshed-1");
  });

  it("falls back to the .env token once a stored one has expired", () => {
    const stored = {
      primary: { source: hashToken("env-token"), token: "old", refreshedAt: NOW.toISOString(), expiresAt: "2020-01-01T00:00:00.000Z" }
    };
    expect(effectiveToken("primary", "env-token", stored)).toBe("env-token");
    expect(readStoredTokens()).toEqual({});
  });
});

describe("the refresh request's documented fallback", () => {
  const DOCUMENTED = "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=";

  function sequence(...responses: Array<Response | Error>) {
    const fetchMock = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected extra fetch.");
      if (next instanceof Error) throw next;
      return next;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const refused = (status: number, message: string) =>
    new Response(JSON.stringify({ error: { message, type: "OAuthException", code: 190 } }), { status });

  const requestsOf = (fetchMock: ReturnType<typeof sequence>) =>
    (fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>).map(([url, init]) => ({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>
    }));

  it("retries once with the access_token query form when the header form is refused for a reason other than expiry", async () => {
    const fetchMock = sequence(refused(401, "Invalid OAuth access token - Cannot parse access token"), new Response(
      JSON.stringify({ access_token: "refreshed-1", expires_in: 5_184_000 }), { status: 200 }
    ));

    const outcomes = await refresh(connect());

    const [first, second] = requestsOf(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.headers.Authorization).toBe("Bearer env-token");
    expect(second.url).toBe(`${DOCUMENTED}env-token`);
    expect(second.headers.Authorization).toBeUndefined();
    expect(outcomes[0].outcome).toBe("refreshed");
    expect(threadsConfig().accounts[0].accessToken).toBe("refreshed-1");
  });

  it("retries on a 400 as well", async () => {
    const fetchMock = sequence(
      refused(400, "Unsupported get request"),
      new Response(JSON.stringify({ access_token: "refreshed-1", expires_in: 5_184_000 }), { status: 200 })
    );

    await refresh(connect());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the token has really expired, because the other form cannot fix that", async () => {
    const fetchMock = sequence(refused(401, "Error validating access token: Session has expired on Thursday"));

    const outcomes = await refresh(connect());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcomes[0].outcome).toBe("failed");
  });

  it.each([403, 429, 500])("does not retry on HTTP %i", async (status) => {
    const fetchMock = sequence(refused(status, "nope"));

    await refresh(connect());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries at most once", async () => {
    const fetchMock = sequence(refused(400, "Unsupported get request"), refused(400, "Unsupported get request"));

    const outcomes = await refresh(connect());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes[0].outcome).toBe("failed");
  });

  it("never lets the token reach a log line, a result or the stored file, in either form", async () => {
    const token = "TH+Q/ab=c&d e";
    const encoded = encodeURIComponent(token);
    const formEncoded = new URLSearchParams({ t: token }).toString().slice(2);
    const sinks = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    sequence(
      refused(401, `Invalid OAuth access token ${token}`),
      new TypeError(`fetch failed: GET ${DOCUMENTED}${encoded} (${formEncoded})`)
    );

    const outcomes = await refresh(connect(token));

    const everything = [
      JSON.stringify(outcomes),
      JSON.stringify(readStoredTokens()),
      ...sinks.flatMap((sink) => sink.mock.calls.map((call) => call.map(String).join(" ")))
    ].join("\n");
    for (const form of [token, encoded, formEncoded]) expect(everything).not.toContain(form);
    expect(outcomes[0].outcome).toBe("failed");
    sinks.forEach((sink) => sink.mockRestore());
  });
});
