import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/analytics/route";
import { POST } from "@/app/api/analytics/sync/route";
import { metricsFile, readMetrics, updateMetrics } from "@/lib/analytics/store";
import { syncInFlight } from "@/lib/analytics/sync";
import { dataPath } from "@/lib/paths";
import { newPlatformState } from "@/lib/publisher/queue";
import { testItem } from "@/lib/publisher/test-helpers";

const post = () => POST();

async function seedQueue() {
  const item = testItem({ id: "queued", platformIds: ["youtube"], title: "A published clip" });
  item.platforms.youtube = { ...newPlatformState(), status: "published", postId: "ytsyncroute1", publishedAt: new Date().toISOString() };
  await writeFile(dataPath("publish-queue.json"), JSON.stringify([item]));
}

beforeEach(async () => {
  await syncInFlight();
  await rm(path.dirname(metricsFile()), { recursive: true, force: true });
  await seedQueue();
});

describe("POST /api/analytics/sync", () => {
  it("starts a sync without waiting for it, and the sync then reads the queue and records its result", async () => {
    const response = await post();

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ started: true, running: true });

    await syncInFlight();
    const store = await readMetrics();
    expect(store.sync).toMatchObject({ lastResult: "ok", running: null });
    expect(store.posts["youtube:ytsyncroute1"]).toMatchObject({ title: "A published clip", platform: "youtube" });
    expect(store.accounts["youtube:youtube-primary"]).toMatchObject({ status: "not-connected" });
  });

  it("does not start a second sync while one is running", async () => {
    const [first, second] = await Promise.all([post(), post()]);

    expect((await first.json()).started).toBe(true);
    expect(await second.json()).toMatchObject({ started: false, running: true });
    await syncInFlight();
  });

  it("shows up as running in GET /api/analytics while it works", async () => {
    await post();

    const body = await (await GET(new NextRequest("http://127.0.0.1:3000/api/analytics"))).json();

    expect(body.sync.running).toBe(true);
    await syncInFlight();
  });

  it("refuses a second Sync now within ten minutes, and says how long to wait", async () => {
    await post();
    await syncInFlight();

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ started: false, reason: "cooldown" });
    expect(body.retryAfterSeconds).toBeGreaterThan(590);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(600);
    expect(response.headers.get("Retry-After")).toBe(String(body.retryAfterSeconds));
  });

  it("allows Sync now again once the cooldown has passed", async () => {
    await post();
    await syncInFlight();
    await updateMetrics((store) => {
      store.sync.lastManualAt = new Date(Date.now() - 11 * 60_000).toISOString();
    });

    const response = await post();

    expect(response.status).toBe(202);
    expect((await response.json()).started).toBe(true);
    await syncInFlight();
  });
});
