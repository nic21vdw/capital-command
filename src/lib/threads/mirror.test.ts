import { afterEach, describe, expect, it, vi } from "vitest";
import { postToThreads, StillProcessingError } from "@/lib/threads/api";
import type { ThreadsConfig } from "@/lib/threads/config";
import { mediaFor, planInstagramMirrors, threadsCaption, type MirrorConfig } from "@/lib/threads/mirror";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { QueueItem } from "@/lib/publisher/types";

const threads = {
  enabled: true,
  accounts: [{ id: "primary", label: "nic", userId: "42", accessToken: "token-mirror", posts: "variant", offsetMinutes: 0 }],
  apiBase: "https://graph.threads.net",
  apiVersion: "v1.0",
  timezone: "America/Toronto",
  plugReplies: false,
  plugUrl: "https://colateralai.com",
  plugScope: "colateral"
} as unknown as ThreadsConfig;

const mirror: MirrorConfig = { enabled: true, carousels: true, offsetMinutes: 20, lookbackHours: 12, gapMinutes: 30 };
const NOW = new Date("2026-11-25T00:30:00Z");

function reel(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "item-1",
    clipPath: "data/clips/a.mp4",
    mediaKey: "clips/item-1.mp4",
    title: "Road to 3K: 24 hours at 3,000 (reel-b)",
    caption: "At 3,000 subscribers I go live for 24 hours straight. Chat picks, I build it live. What should I build or play first?",
    hashtags: ["#vibecoding"],
    publishAt: "2026-11-24T23:30:00Z",
    visibility: "public",
    createdAt: "2026-11-20T00:00:00Z",
    platforms: { instagram: { status: "published", attempts: 1, postId: "ig-1", publishedAt: "2026-11-24T23:34:09Z" } },
    ...overrides
  } as QueueItem;
}

function deck(): QueueItem {
  return reel({
    id: "deck-1",
    mediaKind: "image",
    mediaKey: undefined,
    imagePaths: ["a.png", "b.png", "c.png"],
    imageKeys: ["img/a.png", "img/b.png", "img/c.png"],
    caption: "Claude Code vs Codex on one repo #ai #buildinpublic\n\nWhich would you pick?",
    platforms: { instagram: { status: "published", attempts: 1, postId: "ig-2", publishedAt: "2026-11-24T22:00:00Z" } }
  });
}

describe("mirroring Instagram to Threads", () => {
  it("books a published Reel once, 20 minutes after Instagram, with its caption and video", () => {
    const plan = planInstagramMirrors({ publishItems: [reel()], queue: [], threads, mirror, now: new Date("2026-11-24T23:40:00Z"), newId: () => "t-1" });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      id: "t-1",
      accountId: "primary",
      version: "variant",
      origin: "pipeline",
      sourceItemId: "item-1",
      status: "pending",
      format: "instagram-video",
      media: { kind: "video", keys: ["clips/item-1.mp4"] },
      publishAt: "2026-11-24T23:54:09.000Z",
      text: "At 3,000 subscribers I go live for 24 hours straight. Chat picks, I build it live. What should I build or play first?"
    });
    const again = planInstagramMirrors({ publishItems: [reel()], queue: plan.items, threads, mirror, now: NOW });
    expect(again.items).toEqual([]);
  });

  it("turns a deck into a carousel and strips hashtags", () => {
    const [item] = planInstagramMirrors({ publishItems: [deck()], queue: [], threads, mirror, now: NOW }).items;
    expect(item.media).toEqual({ kind: "carousel", keys: ["img/a.png", "img/b.png", "img/c.png"] });
    expect(item.text).toBe("Claude Code vs Codex on one repo\n\nWhich would you pick?");
    expect(planInstagramMirrors({ publishItems: [deck()], queue: [], threads, mirror: { ...mirror, carousels: false }, now: NOW }).items).toEqual([]);
  });

  it("never posts sooner than five minutes from now, and keeps clear of other Threads posts", () => {
    const busy = [{ id: "x", accountId: "primary", status: "pending", publishAt: "2026-11-25T00:40:00Z", text: "other" } as ThreadsQueueItem];
    const [item] = planInstagramMirrors({ publishItems: [reel()], queue: busy, threads, mirror, now: NOW }).items;
    expect(Date.parse(item.publishAt) - Date.parse("2026-11-25T00:40:00Z")).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it("leaves out private, old, unhosted and engineering posts", () => {
    const plan = planInstagramMirrors({
      publishItems: [
        reel({ id: "private", visibility: "private" }),
        reel({ id: "old", platforms: { instagram: { status: "published", attempts: 1, publishedAt: "2026-11-23T00:00:00Z" } } }),
        reel({ id: "unhosted", mediaKey: undefined }),
        reel({ id: "eng", caption: "How I sped up my structural checks with Claude Code. Which tool do you use?" }),
        reel({ id: "pending", platforms: { instagram: { status: "pending", attempts: 0 } } })
      ],
      queue: [],
      threads,
      mirror,
      now: NOW
    });
    expect(plan.items).toEqual([]);
    expect(plan.notes.map((note) => note.itemId)).toEqual(["private", "unhosted", "eng"]);
  });

  it("does nothing when switched off or with no account", () => {
    expect(planInstagramMirrors({ publishItems: [reel()], queue: [], threads, mirror: { ...mirror, enabled: false }, now: NOW }).items).toEqual([]);
    expect(planInstagramMirrors({ publishItems: [reel()], queue: [], threads: { ...threads, accounts: [] }, mirror, now: NOW }).items).toEqual([]);
  });

  it("falls back to the title without its cut label when the caption is empty", () => {
    expect(threadsCaption({ caption: "#ai #shorts", title: "Road to 3K: 24 hours at 3,000 (reel-b)" })).toBe("Road to 3K: 24 hours at 3,000");
    expect(mediaFor(reel({ mediaKind: "image", imagePaths: ["a.png"], imageKeys: ["img/a.png"] }))).toEqual({ kind: "image", keys: ["img/a.png"] });
  });
});

describe("posting media to Threads", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(responses: Array<Record<string, unknown>>) {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : "" });
      const next = responses.shift();
      if (!next) throw new Error(`Unexpected call ${url}`);
      return new Response(JSON.stringify(next), { status: 200 });
    }));
    return calls;
  }

  const account = threads.accounts[0];
  const poll = { polls: 3, delayMs: 0, sleep: async () => undefined };

  it("creates a video container, waits for FINISHED, then publishes", async () => {
    const calls = stub([{ id: "c-1" }, { status: "IN_PROGRESS" }, { status: "FINISHED" }, { id: "post-1" }]);
    const result = await postToThreads({ account: { ...account, accessToken: "tok-video" }, text: "Reel caption", media: { kind: "video", urls: ["https://cdn/x.mp4"] }, mediaPoll: poll }, threads);
    expect(result).toEqual({ containerId: "c-1", postId: "post-1" });
    expect(calls[0].body).toContain("media_type=VIDEO");
    expect(calls[0].body).toContain("video_url=https%3A%2F%2Fcdn%2Fx.mp4");
    expect(calls[1].url).toContain("c-1?fields=status");
    expect(calls[3].url).toContain("threads_publish");
  });

  it("makes one child per picture, then the carousel", async () => {
    const calls = stub([{ id: "k1" }, { id: "k2" }, { id: "parent" }, { status: "FINISHED" }, { id: "post-2" }]);
    await postToThreads({ account: { ...account, accessToken: "tok-deck" }, text: "Deck", media: { kind: "carousel", urls: ["https://cdn/a.png", "https://cdn/b.png"] }, mediaPoll: poll }, threads);
    expect(calls[0].body).toContain("is_carousel_item=true");
    expect(calls[2].body).toContain("media_type=CAROUSEL");
    expect(calls[2].body).toContain("children=k1%2Ck2");
  });

  it("keeps the container and retries later while Threads is still processing", async () => {
    stub([{ id: "c-9" }, { status: "IN_PROGRESS" }, { status: "IN_PROGRESS" }, { status: "IN_PROGRESS" }]);
    const saved: string[] = [];
    await expect(
      postToThreads({ account: { ...account, accessToken: "tok-slow" }, text: "Slow", media: { kind: "video", urls: ["https://cdn/s.mp4"] }, mediaPoll: poll, onContainerCreated: async (id) => { saved.push(id); } }, threads)
    ).rejects.toBeInstanceOf(StillProcessingError);
    expect(saved).toEqual(["c-9"]);
  });

  it("resumes an existing container without creating another", async () => {
    const calls = stub([{ status: "FINISHED" }, { id: "post-3" }]);
    const result = await postToThreads({ account: { ...account, accessToken: "tok-resume" }, text: "Slow", containerId: "c-9", media: { kind: "video", urls: [] }, mediaPoll: poll }, threads);
    expect(result.postId).toBe("post-3");
    expect(calls).toHaveLength(2);
  });
});
