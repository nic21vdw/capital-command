import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetReviewPolicyCache, reviewPolicyPath } from "@/lib/publisher/approvalStore";
import { PublishQueue } from "@/lib/publisher/queue";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import { readQueue, writeQueue } from "@/lib/threads/queue";
import type { ThreadsQueueItem } from "@/lib/threads/types";

let queue: PublishQueue;

vi.mock("@/lib/publisher/queue", async () => ({
  ...(await vi.importActual<typeof import("@/lib/publisher/queue")>("@/lib/publisher/queue")),
  publishQueue: () => queue
}));

const url = (suffix: string) => `http://localhost:3000/api/review/${suffix}`;

async function policyRoute() {
  return import("@/app/api/review/policy/route");
}
async function awaitingRoute() {
  return import("@/app/api/review/awaiting/route");
}
async function approveRoute() {
  return import("@/app/api/review/approve/route");
}

const put = async (body: unknown) => (await policyRoute()).PUT(new Request(url("policy"), { method: "PUT", body: JSON.stringify(body) }));
const approve = async (body: unknown) => (await approveRoute()).POST(new Request(url("approve"), { method: "POST", body: JSON.stringify(body) }));
const awaiting = async () => (await awaitingRoute()).GET();

const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function backdateHold(channel: string, hoursAgo: number) {
  const saved = JSON.parse(await readFile(reviewPolicyPath(), "utf8"));
  saved.heldSince = { ...saved.heldSince, [channel]: soon(-hoursAgo) };
  await writeFile(reviewPolicyPath(), JSON.stringify(saved), "utf8");
  resetReviewPolicyCache();
}

const threadsRow = (overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem => ({
  id: "t1",
  batchDate: "2026-07-22",
  slot: 1,
  accountId: "primary",
  version: "text",
  topic: "a topic",
  format: "insight",
  text: "the post",
  publishAt: "2026-07-22T07:15:00.000Z",
  status: "pending",
  attempts: 0,
  createdAt: "2026-07-22T06:00:00.000Z",
  ...overrides
});

beforeEach(async () => {
  resetReviewPolicyCache();
  queue = new PublishQueue(new MemoryQueueStore(), testConfig({ platforms: ["youtube", "instagram", "tiktok", "facebook"], shortsPerDay: 2 }));
  await mkdir(path.dirname(reviewPolicyPath()), { recursive: true });
  await rm(reviewPolicyPath(), { force: true });
  await writeQueue([]);
});

afterEach(async () => {
  await rm(reviewPolicyPath(), { force: true });
  await writeQueue([]);
});

describe("/api/review/policy", () => {
  it("reports auto everywhere until something is saved", async () => {
    const body = await (await policyRoute()).GET().then((response) => response.json());
    expect(body.policy).toEqual({ youtube: "auto", instagram: "auto", tiktok: "auto", facebook: "auto", threads: "auto" });
    expect(body.error).toBeNull();
  });

  it("saves the channels it is given and keeps the rest", async () => {
    expect((await (await put({ instagram: "hold" })).json()).policy.instagram).toBe("hold");
    const body = await (await put({ threads: "hold" })).json();
    expect(body.policy).toEqual({ youtube: "auto", instagram: "hold", tiktok: "auto", facebook: "auto", threads: "hold" });
    expect((await (await policyRoute()).GET().then((response) => response.json())).policy).toEqual(body.policy);
  });

  it("refuses a body it cannot read", async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ instagram: "maybe" })).status).toBe(400);
    expect((await put({ bluesky: "hold" })).status).toBe(400);
    expect((await put("hold")).status).toBe(400);
    const broken = await (await policyRoute()).PUT(new Request(url("policy"), { method: "PUT", body: "{" }));
    expect(broken.status).toBe(400);
  });
});

describe("/api/review/awaiting", () => {
  it("is empty while every channel is on auto", async () => {
    await queue.add(testItem({ id: "a", platformIds: ["instagram"] }));
    await writeQueue([threadsRow()]);
    const body = await (await awaiting()).json();
    expect(body).toMatchObject({ total: 0, items: [] });
  });

  it("lists what a held channel is waiting on, soonest first", async () => {
    await put({ instagram: "hold", threads: "hold" });
    await queue.add(testItem({ id: "a", title: "Reel one", caption: "caption one", publishAt: "2026-07-23T12:00:00.000Z", platformIds: ["instagram", "youtube"] }));
    await writeQueue([threadsRow({ publishAt: "2026-07-22T07:15:00.000Z" }), threadsRow({ id: "t2", status: "published", postId: "p" })]);

    const body = await (await awaiting()).json();

    expect(body.total).toBe(2);
    expect(body.items.map((entry: { key: string }) => entry.key)).toEqual(["threads:t1", "instagram:a"]);
    expect(body.items[0]).toMatchObject({ channel: "threads", id: "t1", title: "a topic", caption: "the post" });
    expect(body.items[1]).toMatchObject({ channel: "instagram", id: "a", title: "Reel one", caption: "caption one" });
  });
});

describe("/api/review/approve", () => {
  beforeEach(async () => {
    await put({ instagram: "hold", tiktok: "hold", threads: "hold" });
    await queue.add(testItem({ id: "a", platformIds: ["instagram", "tiktok"], publishAt: soon(30) }));
    await writeQueue([threadsRow(), threadsRow({ id: "t2", slot: 2 })]);
  });

  it("approves one post on one channel", async () => {
    const response = await approve({ channel: "instagram", id: "a" });
    expect(await response.json()).toMatchObject({ approved: 1, moved: [] });
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeTruthy();
    expect((await queue.get("a"))!.platforms.tiktok?.approvedAt).toBeUndefined();
  });

  it("approves one Threads post", async () => {
    const response = await approve({ channel: "threads", id: "t2" });
    expect(await response.json()).toMatchObject({ approved: 1 });
    const rows = await readQueue();
    expect(rows.find((row) => row.id === "t2")?.approvedAt).toBeTruthy();
    expect(rows.find((row) => row.id === "t1")?.approvedAt).toBeUndefined();
  });

  it("approves exactly the keys it is given and nothing else that is waiting", async () => {
    const response = await approve({ keys: ["tiktok:a", "threads:t1"] });
    expect(await response.json()).toMatchObject({ approved: 2 });
    expect((await queue.get("a"))!.platforms.tiktok?.approvedAt).toBeTruthy();
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeUndefined();
    const rows = await readQueue();
    expect(rows.find((row) => row.id === "t1")?.approvedAt).toBeTruthy();
    expect(rows.find((row) => row.id === "t2")?.approvedAt).toBeUndefined();
    expect((await (await awaiting()).json()).total).toBe(2);
  });

  it("ignores keys that are not waiting, are on auto, or are not there", async () => {
    await queue.add(testItem({ id: "b", platformIds: ["youtube"], publishAt: soon(30), clipPath: "data/clips/outputs/job1/b.mp4" }));
    const response = await approve({ keys: ["youtube:b", "instagram:missing", "youtube:a", "threads:missing", "nonsense", "instagram:a"] });
    expect(await response.json()).toMatchObject({ approved: 1 });
    expect((await queue.get("b"))!.platforms.youtube?.approvedAt).toBeUndefined();
    expect((await queue.get("a"))!.platforms.tiktok?.approvedAt).toBeUndefined();
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeTruthy();
  });

  it("does not take a whole-queue approval any more", async () => {
    expect((await approve({ all: true })).status).toBe(400);
    expect((await approve({ all: true, channel: "tiktok" })).status).toBe(400);
    expect((await (await awaiting()).json()).total).toBe(4);
  });

  it("moves a post whose slot is too old to a later slot instead of posting it late", async () => {
    await queue.add(testItem({ id: "old", platformIds: ["instagram"], publishAt: soon(-72), clipPath: "data/clips/outputs/job1/old.mp4" }));
    const body = await (await approve({ keys: ["instagram:old"] })).json();
    expect(body.approved).toBe(1);
    expect(body.moved).toEqual([{ key: "instagram:old", publishAt: expect.any(String), reason: "slot-too-old" }]);
    const item = (await queue.get("old"))!;
    expect(new Date(item.publishAt).getTime()).toBeGreaterThan(Date.now());
    expect(item.platforms.instagram?.approvedAt).toBeTruthy();
  });

  it("releases no more than a day's cap at once and queues the rest for later slots", async () => {
    const ids = ["x1", "x2", "x3", "x4", "x5"];
    for (const [index, id] of ids.entries()) {
      await queue.add(testItem({ id, platformIds: ["instagram"], publishAt: soon(-2 - index * 0.1), clipPath: `data/clips/outputs/job1/${id}.mp4` }));
    }
    const body = await (await approve({ keys: ids.map((id) => `instagram:${id}`) })).json();
    expect(body.approved).toBe(5);
    expect(body.moved.length).toBeGreaterThanOrEqual(3);
    const dueNow = (await queue.dueItems(new Date())).filter((entry) => ids.includes(entry.item.id));
    expect(dueNow.length).toBeLessThanOrEqual(2);
  });

  it("says so when the post is not there", async () => {
    expect((await approve({ channel: "instagram", id: "missing" })).status).toBe(404);
    expect((await approve({ channel: "youtube", id: "a" })).status).toBe(404);
    expect((await approve({ channel: "threads", id: "missing" })).status).toBe(404);
  });

  it("refuses a body it cannot read", async () => {
    expect((await approve({})).status).toBe(400);
    expect((await approve({ channel: "bluesky", id: "a" })).status).toBe(400);
    expect((await approve({ keys: [] })).status).toBe(400);
    expect((await approve({ keys: "instagram:a" })).status).toBe(400);
  });
});

describe("switching a channel from hold to auto", () => {
  it("releases what was held through the same cap and slot-age rules", async () => {
    await put({ instagram: "hold" });
    await backdateHold("instagram", 400);
    const ids = ["h1", "h2", "h3", "h4"];
    for (const [index, id] of ids.entries()) {
      await queue.add(testItem({ id, platformIds: ["instagram"], publishAt: soon(-3 - index * 0.1), clipPath: `data/clips/outputs/job1/${id}.mp4` }));
    }
    await queue.add(testItem({ id: "ancient", platformIds: ["instagram"], publishAt: soon(-200), clipPath: "data/clips/outputs/job1/ancient.mp4" }));
    const body = await (await put({ instagram: "auto" })).json();
    expect(body.policy.instagram).toBe("auto");
    expect(body.released.approved).toBe(5);
    const dueNow = await queue.dueItems(new Date());
    expect(dueNow.length).toBeLessThanOrEqual(2);
    expect(new Date((await queue.get("ancient"))!.publishAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("releases only what the hold itself kept back, and leaves a legacy past-slot leg exactly as it was", async () => {
    await queue.add(testItem({ id: "legacy", platformIds: ["tiktok"], publishAt: soon(-120), clipPath: "data/clips/outputs/job1/legacy.mp4" }));
    await put({ tiktok: "hold" });
    await backdateHold("tiktok", 6);
    await queue.add(testItem({ id: "kept-back", platformIds: ["tiktok"], publishAt: soon(-2), clipPath: "data/clips/outputs/job1/kept.mp4" }));
    await queue.add(testItem({ id: "upcoming", platformIds: ["tiktok"], publishAt: soon(40), clipPath: "data/clips/outputs/job1/upcoming.mp4" }));
    const legacyBefore = structuredClone(await queue.get("legacy"));

    const body = await (await put({ tiktok: "auto" })).json();

    expect(body.released.approved).toBe(2);
    expect(await queue.get("legacy")).toEqual(legacyBefore);
    expect((await queue.get("legacy"))!.platforms.tiktok?.approvedAt).toBeUndefined();
    expect((await queue.get("kept-back"))!.platforms.tiktok?.approvedAt).toBeUndefined();
    expect((await queue.get("upcoming"))!.platforms.tiktok?.approvedAt).toBeUndefined();
    expect(queue.duePlatforms((await queue.get("kept-back"))!, new Date())).toContain("tiktok");
  });

  it("treats everything awaiting as held when the file never recorded when the hold began", async () => {
    await writeFile(reviewPolicyPath(), JSON.stringify({ youtube: "auto", instagram: "hold", tiktok: "auto", facebook: "auto", threads: "auto" }), "utf8");
    resetReviewPolicyCache();
    await queue.add(testItem({ id: "old", platformIds: ["instagram"], publishAt: soon(-120), clipPath: "data/clips/outputs/job1/old.mp4" }));
    const body = await (await put({ instagram: "auto" })).json();
    expect(body.released.approved).toBe(1);
  });

  it("does not release anything when a channel goes from auto to hold", async () => {
    await queue.add(testItem({ id: "a", platformIds: ["instagram"], publishAt: soon(-3) }));
    const body = await (await put({ instagram: "hold" })).json();
    expect(body.released).toEqual({ approved: 0, moved: [] });
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeUndefined();
  });

  it("refuses to flip, and keeps holding, when some posts have no slot to go to", async () => {
    queue = new PublishQueue(new MemoryQueueStore(), testConfig({ bookingHorizonDays: 0 }));
    await put({ instagram: "hold" });
    await backdateHold("instagram", 400);
    await queue.add(testItem({ id: "stuck", platformIds: ["instagram"], publishAt: soon(-300) }));
    const response = await put({ instagram: "auto" });
    expect(response.status).toBe(409);
    expect((await (await policyRoute()).GET().then((reply) => reply.json())).policy.instagram).toBe("hold");
  });
});

describe("an unreadable policy file", () => {
  it("is not overwritten by a change, and the change is refused with the read error", async () => {
    await writeFile(reviewPolicyPath(), "{ not json", "utf8");
    const response = await put({ instagram: "auto" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/could not be read/i);
    expect(await readFile(reviewPolicyPath(), "utf8")).toBe("{ not json");
  });

  it("holds every channel and reports the problem on both reads", async () => {
    await writeFile(reviewPolicyPath(), "{ not json", "utf8");
    const policy = await (await policyRoute()).GET().then((response) => response.json());
    expect(policy.policy).toEqual({ youtube: "hold", instagram: "hold", tiktok: "hold", facebook: "hold", threads: "hold" });
    expect(policy.error).toMatch(/could not be read/i);
    await queue.add(testItem({ id: "a", platformIds: ["instagram"], publishAt: soon(30) }));
    const listing = await (await awaiting()).json();
    expect(listing.error).toMatch(/could not be read/i);
    expect(listing.items.map((entry: { key: string }) => entry.key)).toEqual(["instagram:a"]);
  });
});
