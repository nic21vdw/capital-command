import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publisherConfig } from "@/lib/publisher/config";
import { PATCH } from "@/app/api/automations/cadence/route";

// Only the FILE is redirected, so the test can never write a real .env.
const fixture = { file: "" };
vi.mock("@/lib/podcast/publicUrl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/podcast/publicUrl")>()),
  envFilePath: () => fixture.file
}));

beforeEach(async () => {
  fixture.file = path.join(await mkdtemp(path.join(tmpdir(), "cc-cadence-route-")), ".env");
  vi.stubEnv("PUBLISH_SHORTS_PER_DAY", "");
  vi.stubEnv("PUBLISH_SLOT_TIMES", "");
  vi.stubEnv("PUBLISH_WEEKEND_SLOT_TIMES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(body: unknown, origin = "http://localhost:3100") {
  return new NextRequest("http://localhost:3100/api/automations/cadence", { method: "PATCH", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
}

describe("PATCH /api/automations/cadence", () => {
  it("saves to .env and publisherConfig() sees it on the next call", async () => {
    const response = await PATCH(request({ shortsPerDay: 3, slotTimes: ["18:00", "09:00"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shortsPerDay: 3, slotTimes: ["09:00", "18:00"] });
    const config = publisherConfig();
    expect(config.shortsPerDay).toBe(3);
    expect(config.slotTimes).toEqual(["09:00", "18:00"]);
    const file = await readFile(fixture.file, "utf8");
    expect(file).toContain("PUBLISH_SHORTS_PER_DAY=3");
    expect(file).toContain("PUBLISH_SLOT_TIMES=09:00,18:00");
  });

  it("rejects bad values with a plain message and writes nothing", async () => {
    const response = await PATCH(request({ shortsPerDay: 9 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at most 6/);
    expect(await readFile(fixture.file, "utf8").catch(() => null)).toBeNull();
    expect(process.env.PUBLISH_SHORTS_PER_DAY).toBe("");
  });

  it("rejects another origin", async () => {
    expect((await PATCH(request({ shortsPerDay: 3 }, "https://outside.example"))).status).toBe(403);
    expect(await readFile(fixture.file, "utf8").catch(() => null)).toBeNull();
  });

  it("returns a plain error when .env cannot be written", async () => {
    fixture.file = path.join(fixture.file, "not-a-folder", ".env");
    const response = await PATCH(request({ shortsPerDay: 3 }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/could not be (saved|read)/);
    expect(process.env.PUBLISH_SHORTS_PER_DAY).toBe("");
  });
});
