import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTIONS_TIMEOUT_MS,
  EMPTY_CONNECTIONS,
  connectionsFailed,
  fetchAccountRows,
  parseAccountRows,
  readConnectionsCache,
  summarize
} from "@/components/layout/shell-connections";

const youtube = {
  id: "youtube-primary",
  platform: "youtube",
  primary: true,
  connected: true,
  youtube: { title: "Test channel", thumbnail: null, handle: "test" },
  needsReconnect: false
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shell account status recovery", () => {
  it("distinguishes a failed first read from a confirmed empty account list", () => {
    expect(connectionsFailed(EMPTY_CONNECTIONS)).toMatchObject({
      loaded: false, loading: false, error: "Account status unavailable"
    });
    expect(summarize(parseAccountRows({ accounts: [] }))).toMatchObject({
      loaded: true, loading: false, error: null, channel: null
    });
  });

  it("retains the last channel and blockers when a later read fails", () => {
    const known = summarize(parseAccountRows({ accounts: [youtube, {
      id: "tiktok-primary", platform: "tiktok", primary: true,
      connected: true, youtube: null, blocker: "App review pending", needsReconnect: true
    }] }));
    const failed = connectionsFailed(known);
    expect(failed.channel).toEqual(known.channel);
    expect(failed.others).toEqual(known.others);
    expect(failed).toMatchObject({ loaded: true, loading: false, error: "Account status out of date" });
    expect(failed.others.find((row) => row.platform === "tiktok")).toMatchObject({
      blocker: "App review pending", reconnectAccountId: "tiktok-primary"
    });
  });

  it("clears the warning and replaces retained data after a successful retry", () => {
    const failed = connectionsFailed(summarize(parseAccountRows({ accounts: [youtube] })));
    expect(failed.error).not.toBeNull();
    const recovered = summarize(parseAccountRows({ accounts: [{ ...youtube, youtube: {
      title: "Renamed channel", thumbnail: null
    } }] }));
    expect(recovered).toMatchObject({ error: null, loading: false, channel: { title: "Renamed channel" } });
  });

  it.each([{}, { accounts: null }, { accounts: [null] }, { accounts: [{ ...youtube, connected: "yes" }] },
    { accounts: [{ ...youtube, youtube: { title: 42, thumbnail: null } }] }])(
    "rejects malformed success payloads instead of guessing that nothing is connected: %j", (payload) => {
      expect(() => parseAccountRows(payload)).toThrow();
    }
  );

  it("validates stale cache records before offering them as retained status", () => {
    const accounts = parseAccountRows({ accounts: [youtube] });
    expect(readConnectionsCache(JSON.stringify({ at: 1, accounts }))).toEqual({ at: 1, accounts });
    expect(readConnectionsCache(JSON.stringify({ at: 1, accounts: "bad" }))).toBeNull();
    expect(readConnectionsCache(JSON.stringify({ at: "yesterday", accounts }))).toBeNull();
    expect(readConnectionsCache("not json")).toBeNull();
    expect(readConnectionsCache(null)).toBeNull();
  });

  it("refuses HTTP failures and malformed JSON returned with HTTP 200", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: "Missing accounts" }))
      .mockResolvedValueOnce(new Response("not json"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAccountRows()).rejects.toThrow("Could not read account status");
    await expect(fetchAccountRows()).rejects.toThrow();
    await expect(fetchAccountRows()).rejects.toThrow();
  });

  it("bounds a stalled fetch so the shell can offer Retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Read timed out", "TimeoutError")), delay);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    })));
    const result = expect(fetchAccountRows()).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(CONNECTIONS_TIMEOUT_MS);
    await result;
  });

  it("selects the primary YouTube channel and preserves the additional-account count", () => {
    const accounts = parseAccountRows({ accounts: [{ ...youtube, id: "youtube-extra", primary: false,
      youtube: { title: "Extra channel", thumbnail: null } }, youtube] });
    expect(summarize(accounts).channel).toMatchObject({ title: "Test channel", extraConnected: 1 });
  });

  it("keeps known channels available when the API adds another platform", () => {
    const accounts = parseAccountRows({ accounts: [youtube, {
      id: "linkedin-primary", platform: "linkedin", primary: true, connected: true,
      youtube: null, profile: { title: "New platform account", thumbnail: null }
    }] });
    const state = summarize(accounts);
    expect(state).toMatchObject({ loaded: true, error: null, channel: { title: "Test channel" } });
    expect(state.others.map((row) => row.platform)).toEqual(["instagram", "tiktok", "facebook"]);
  });
});
