import { afterEach, describe, expect, it, vi } from "vitest";
import { threadsConfig, type ThreadsAccount } from "./config";
import { verifyThreadsPublishingConnection } from "./reconnect";

const account: ThreadsAccount = {
  id: "primary", userId: "1000000000001", label: "Synthetic profile",
  accessToken: "fixture-bearer-only", posts: "text", offsetMinutes: 0
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function config() {
  vi.stubEnv("THREADS_API_BASE", "");
  vi.stubEnv("THREADS_GRAPH_API_VERSION", "");
  return threadsConfig();
}

describe("Threads publishing connection verification", () => {
  it("pins the token profile and makes exactly two no-redirect GET requests to Meta", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: account.userId, username: "Fixture.Profile" }))
      .mockResolvedValueOnce(Response.json({ data: [{ quota_usage: 0 }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyThreadsPublishingConnection(account, config(), { username: " @FIXTURE.PROFILE " }))
      .resolves.toEqual({ userId: account.userId, username: "fixture.profile", quotaUsage: 0 });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://graph.threads.com/v1.0/me?fields=id,username",
      "https://graph.threads.com/v1.0/me/threads_publishing_limit?fields=quota_usage"
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ method: "GET", redirect: "error", cache: "no-store",
        headers: { Authorization: "Bearer fixture-bearer-only" } });
    }
  });

  it("refuses to send the credential to a configured non-Meta host or without an exact identity", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const settings = config();
    await expect(verifyThreadsPublishingConnection(account, { ...settings, apiBase: "https://example.invalid" }, { userId: account.userId }))
      .rejects.toMatchObject({ code: "threads_probe_unavailable" });
    await expect(verifyThreadsPublishingConnection(account, settings, { username: "a name" }))
      .rejects.toMatchObject({ code: "threads_identity_required" });
    await expect(verifyThreadsPublishingConnection(account, settings, {}))
      .rejects.toMatchObject({ code: "threads_identity_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an explicitly supplied handle when the token differs from the installed numeric account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "1000000000002", username: "fixture.profile" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyThreadsPublishingConnection(account, config(), { username: "fixture.profile" }))
      .rejects.toMatchObject({ code: "threads_profile_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds malformed provider readback and suppresses credential material in the error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: account.userId, username: "fixture.profile" }))
      .mockResolvedValueOnce(new Response("fixture-bearer-only"));
    vi.stubGlobal("fetch", fetchMock);
    const error = await verifyThreadsPublishingConnection(account, config(), { userId: account.userId }).catch((error: Error) => error);
    expect(error).toMatchObject({ code: "threads_probe_unavailable" });
    expect(String(error)).not.toContain("fixture-bearer-only");
  });
});
