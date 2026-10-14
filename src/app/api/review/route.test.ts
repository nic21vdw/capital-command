import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewPolicyPath } from "@/lib/publisher/approvalStore";
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
  queue = new PublishQueue(new MemoryQueueStore(), testConfig());
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
    await queue.add(testItem({ id: "a", platformIds: ["instagram", "tiktok"] }));
    await writeQueue([threadsRow(), threadsRow({ id: "t2", slot: 2 })]);
  });

  it("approves one post on one channel", async () => {
    const response = await approve({ channel: "instagram", id: "a" });
    expect(await response.json()).toEqual({ approved: 1 });
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeTruthy();
    expect((await queue.get("a"))!.platforms.tiktok?.approvedAt).toBeUndefined();
  });

  it("approves one Threads post", async () => {
    const response = await approve({ channel: "threads", id: "t2" });
    expect(await response.json()).toEqual({ approved: 1 });
    const rows = await readQueue();
    expect(rows.find((row) => row.id === "t2")?.approvedAt).toBeTruthy();
    expect(rows.find((row) => row.id === "t1")?.approvedAt).toBeUndefined();
  });

  it("approves a whole channel", async () => {
    expect(await (await approve({ all: true, channel: "tiktok" })).json()).toEqual({ approved: 1 });
    expect((await (await awaiting()).json()).total).toBe(3);
  });

  it("approves everything that is waiting", async () => {
    expect(await (await approve({ all: true })).json()).toEqual({ approved: 4 });
    expect((await (await awaiting()).json()).total).toBe(0);
  });

  it("leaves what is on auto alone when it approves all", async () => {
    await put({ instagram: "auto", tiktok: "auto", threads: "auto" });
    expect(await (await approve({ all: true })).json()).toEqual({ approved: 0 });
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeUndefined();
  });

  it("says so when the post is not there", async () => {
    expect((await approve({ channel: "instagram", id: "missing" })).status).toBe(404);
    expect((await approve({ channel: "youtube", id: "a" })).status).toBe(404);
    expect((await approve({ channel: "threads", id: "missing" })).status).toBe(404);
  });

  it("refuses a body it cannot read", async () => {
    expect((await approve({})).status).toBe(400);
    expect((await approve({ channel: "bluesky", id: "a" })).status).toBe(400);
    expect((await approve({ all: false })).status).toBe(400);
  });
});
