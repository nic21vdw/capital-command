import * as fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { accountKey, emptyStore, postKey, type AnalyticsPlatform, type AnalyticsStore, type PostRecord } from "@/lib/analytics/types";
import { createMarketingAnalyticsReader, type TrustedAnalyticsScope } from "./analytics";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, open: vi.fn(real.open) };
});
// Import sentinels: a passive snapshot must not load the original mutable store,
// GET lifecycle, automatic scheduler, provider credentials or sync machinery.
vi.mock("@/lib/analytics/store", () => { throw new Error("mutable store import forbidden"); });
vi.mock("@/lib/analytics/api", () => { throw new Error("analytics lifecycle import forbidden"); });
vi.mock("@/lib/analytics/sync", () => { throw new Error("sync import forbidden"); });
vi.mock("@/lib/analytics/schedule", () => { throw new Error("scheduler import forbidden"); });
vi.mock("@/lib/analytics/credentials", () => { throw new Error("provider credentials import forbidden"); });

const at = new Date("2026-10-21T12:00:00.000Z");
const DAY = 86_400_000;
const file = dataPath("analytics", "metrics.json");
const scopeA: TrustedAnalyticsScope = { ownerId: "owner-a", accounts: [
  { platform: "youtube", accountId: "shared-id" }, { platform: "instagram", accountId: "owner-a-ig" }
] };
const scopeB: TrustedAnalyticsScope = { ownerId: "owner-b", accounts: [
  { platform: "youtube", accountId: "owner-b-yt" }, { platform: "instagram", accountId: "shared-id" }
] };
const read = () => createMarketingAnalyticsReader({ resolveScope: (owner) => owner === "owner-a" ? scopeA : owner === "owner-b" ? scopeB : null, now: () => at });

function post(platform: AnalyticsPlatform, accountId: string, postId: string, daysAgo: number, views?: number): PostRecord {
  return { key: postKey(platform, postId), platform, accountId, postId, itemId: `item-${postId}`,
    title: `Title ${postId}`, caption: "Private caption is outside this DTO", format: "video", status: "ok",
    publishedAt: new Date(at.getTime() - daysAgo * DAY).toISOString(),
    latest: views === undefined ? null : { at: new Date(at.getTime() - DAY).toISOString(), metrics: { views, likes: views / 10, comments: 2 } },
    history: [], syncedAt: new Date(at.getTime() - DAY).toISOString(), misses: 0 };
}

async function seed(posts: PostRecord[] = [
  post("youtube", "shared-id", "a-recent", 1, 100),
  post("youtube", "shared-id", "a-older", 10, 300),
  post("instagram", "owner-a-ig", "a-instagram", 2, 40),
  post("youtube", "owner-b-yt", "b-youtube", 1, 5000),
  post("instagram", "shared-id", "b-instagram", 1, 9000)
]): Promise<AnalyticsStore> {
  const store = emptyStore();
  for (const entry of posts) {
    if (entry.postId.startsWith("b-") && entry.latest) entry.latest.at = at.toISOString();
    store.posts[entry.key] = entry;
    const key = accountKey(entry.platform, entry.accountId);
    store.accounts[key] = { key, platform: entry.platform, accountId: entry.accountId, label: `Label ${entry.accountId}`,
      status: "ok", note: "Bearer PRIVATE_DIAGNOSTIC C:\\Users\\private\\secret", at: at.toISOString(), posts: 1 };
  }
  store.sync.lastError = "provider error Bearer PRIVATE_TOKEN /home/private/path";
  await fs.writeFile(file, JSON.stringify(store));
  return store;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await seed();
});

describe("owner-scoped passive saved analytics", () => {
  it("checks explicit owner/account grants before opening the metrics store", async () => {
    const missing = createMarketingAnalyticsReader({ resolveScope: () => null, now: () => at });
    const mismatch = createMarketingAnalyticsReader({ resolveScope: () => scopeB, now: () => at });
    const result = await missing.snapshot("owner-a");
    expect(result).toMatchObject({ connection: { state: "unavailable" }, store: { state: "not_configured", reason: "scope_unavailable" }, posts: null, totals: null });
    expect((await mismatch.snapshot("owner-a")).store.state).toBe("not_configured");
    expect((await read().snapshot("unknown-owner")).posts).toBeNull();
    expect(fs.open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not infer primary-account ownership and rejects malformed, empty or unavailable scopes", async () => {
    for (const scope of [
      { ownerId: "owner-a", accounts: [] },
      { ownerId: "owner-a", accounts: [{ platform: "youtube", accountId: "../private" }] },
      { ownerId: "owner-a", accounts: [{ platform: "youtube", accountId: "shared-id" }, { platform: "youtube", accountId: "shared-id" }] }
    ]) {
      const reader = createMarketingAnalyticsReader({ resolveScope: () => scope as TrustedAnalyticsScope, now: () => at });
      expect((await reader.snapshot("owner-a")).store.state).toBe("not_configured");
    }
    const unavailable = createMarketingAnalyticsReader({ resolveScope: () => { throw new Error("Bearer private-scope-token"); }, now: () => at });
    expect(JSON.stringify(await unavailable.snapshot("owner-a"))).not.toContain("private-scope-token");
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("isolates account/platform pairs for both owners before posts, freshness and rollups", async () => {
    const a = await read().snapshot("owner-a");
    const b = await read().snapshot("owner-b");
    expect(a.store).toEqual({ state: "loaded" });
    expect(a.posts?.map((row) => row.postId).sort()).toEqual(["a-instagram", "a-older", "a-recent"]);
    expect(b.posts?.map((row) => row.postId).sort()).toEqual(["b-instagram", "b-youtube"]);
    expect(a.accounts?.map((account) => `${account.platform}:${account.accountId}`).sort()).toEqual(["instagram:owner-a-ig", "youtube:shared-id"]);
    expect(a.totals?.last28.map((total) => [total.platform, total.views])).toEqual([["youtube", 400], ["instagram", 40]]);
    expect(b.totals?.last28.map((total) => [total.platform, total.views])).toEqual([["youtube", 5000], ["instagram", 9000]]);
    expect(a.freshness?.latestMeasurementAt).toBe("2026-10-20T12:00:00.000Z");
    expect(b.freshness?.latestMeasurementAt).toBe("2026-10-21T12:00:00.000Z");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies only typed filters and keeps scoped totals independent of the display limit", async () => {
    const result = await read().snapshot("owner-a", { platform: "youtube", windowDays: 28, sort: "views", limit: 1 });
    expect(result.posts?.map((row) => row.postId)).toEqual(["a-older"]);
    expect(result.counts).toEqual({ matchingPosts: 2, returnedPosts: 1, measuredPosts: 2, truncated: true });
    expect(result.accounts?.every((account) => account.platform === "youtube")).toBe(true);
    expect(result.totals?.window).toMatchObject([{ platform: "youtube", views: 400 }]);
    expect(result.totals?.last7).toMatchObject([{ platform: "youtube", views: 100 }]);
    const recent = await read().snapshot("owner-a", { platform: "youtube", windowDays: 7 });
    expect(recent.posts?.map((row) => row.postId)).toEqual(["a-recent"]);
    expect(recent.totals?.window).toMatchObject([{ views: 100 }]);
    vi.mocked(fs.open).mockClear();
    expect((await read().snapshot("owner-a", { platform: "tiktok" })).store.state).toBe("not_configured");
    await expect(read().snapshot("owner-a", { limit: 101 })).rejects.toThrow("allowed platform");
    await expect(read().snapshot("owner-a", { ownerId: "owner-b" } as never)).rejects.toThrow("allowed platform");
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("leaves file bytes, modification time and directory contents unchanged", async () => {
    const before = { bytes: await fs.readFile(file), info: await fs.stat(file), entries: await fs.readdir(path.dirname(file)) };
    await read().snapshot("owner-a");
    await read().snapshot("owner-b", { sort: "engagement", limit: 1 });
    expect(await fs.readFile(file)).toEqual(before.bytes);
    expect((await fs.stat(file)).mtimeMs).toBe(before.info.mtimeMs);
    expect(await fs.readdir(path.dirname(file))).toEqual(before.entries);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("omits raw diagnostics, captions, tokens and paths from the public DTO", async () => {
    const store = await seed();
    store.posts["youtube:a-recent"].title = "Token: SECRET_TITLE C:\\Users\\nic\\video.mp4 https://user:secret@example.test/private?token=secret";
    store.accounts["youtube:shared-id"].label = "Bearer PRIVATE_LABEL /home/private/credential";
    await fs.writeFile(file, JSON.stringify(store));
    const serialized = JSON.stringify(await read().snapshot("owner-a"));
    for (const secret of ["PRIVATE_DIAGNOSTIC", "PRIVATE_TOKEN", "SECRET_TITLE", "PRIVATE_LABEL", "C:\\Users", "/home/private", "user:secret", "Private caption", "lastError", '"note"']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[credential]");
    expect(serialized).toContain("[private path]");
  });

  it("reports a missing store explicitly without creating it or fabricating zero results", async () => {
    await fs.unlink(file);
    const result = await read().snapshot("owner-a");
    expect(result).toMatchObject({ store: { state: "missing" }, posts: null, accounts: null, totals: null, freshness: null });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["{broken", "[]", JSON.stringify({ version: 2, posts: {}, accounts: {}, sync: {} }),
    JSON.stringify({ version: 1, posts: [], accounts: {}, sync: {} })])("reports malformed store bytes explicitly: %s", async (bytes) => {
    await fs.writeFile(file, bytes);
    const result = await read().snapshot("owner-a");
    expect(result).toMatchObject({ store: { state: "unavailable", reason: "malformed" }, posts: null, totals: null });
    expect(await fs.readFile(file, "utf8")).toBe(bytes);
  });

  it("does not silently normalize malformed permitted metrics or absent account identities", async () => {
    const store = await seed();
    (store.posts["youtube:a-recent"].latest!.metrics as Record<string, unknown>).views = "unreadable";
    await fs.writeFile(file, JSON.stringify(store));
    expect((await read().snapshot("owner-a")).store).toEqual({ state: "unavailable", reason: "malformed" });
    const missingAccount = await seed();
    delete (missingAccount.posts["youtube:a-recent"] as Partial<PostRecord>).accountId;
    await fs.writeFile(file, JSON.stringify(missingAccount));
    expect((await read().snapshot("owner-a")).store).toEqual({ state: "unavailable", reason: "malformed" });
  });

  it("redacts unreadable-store failures", async () => {
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error("C:\\private\\metrics.json token=PRIVATE"), { code: "EACCES" }));
    const result = await read().snapshot("owner-a");
    expect(result.store).toEqual({ state: "unavailable", reason: "unreadable" });
    expect(JSON.stringify(result)).not.toMatch(/C:\\private|PRIVATE/);
  });

  it("distinguishes a valid empty store and unmeasured posts from unavailable data", async () => {
    await fs.writeFile(file, JSON.stringify(emptyStore()));
    const empty = await read().snapshot("owner-a");
    expect(empty).toMatchObject({ store: { state: "loaded" }, accounts: [], posts: [], totals: { window: [], last7: [], last28: [] }, counts: { matchingPosts: 0 }, freshness: { latestMeasurementAt: null } });
    await seed([post("youtube", "shared-id", "unmeasured", 1)]);
    const unmeasured = await read().snapshot("owner-a");
    expect(unmeasured.posts).toMatchObject([{ measured: false, metrics: {}, engagements: null }]);
    expect(unmeasured.totals?.window).toMatchObject([{ posts: 1, measured: 0, views: null, likes: null, comments: null, engagements: null }]);
    expect(unmeasured.freshness?.latestMeasurementAt).toBeNull();
  });
});
