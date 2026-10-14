import { rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/analytics/route";
import { POST } from "@/app/api/analytics/sync/route";
import { metricsFile, readMetrics } from "@/lib/analytics/store";
import { syncInFlight } from "@/lib/analytics/sync";

const post = () => POST();

beforeEach(async () => {
  await syncInFlight();
  await rm(path.dirname(metricsFile()), { recursive: true, force: true });
});

describe("POST /api/analytics/sync", () => {
  it("starts a sync without waiting for it, and the sync then records its result", async () => {
    const response = await post();

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ started: true, running: true });

    await syncInFlight();
    expect((await readMetrics()).sync).toMatchObject({ lastResult: "ok", running: null });
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
});
