import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { dataPath, dataRoot } from "@/lib/paths";

afterEach(() => rmSync(dataPath("backup-status.json"), { force: true }));

describe("GET /api/backup/status", () => {
  it("reports null when no backup has ever run", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ status: null });
  });

  it("returns what the last backup recorded", async () => {
    mkdirSync(dataRoot(), { recursive: true });
    const status = { at: "2026-10-13T07:30:00.000Z", ok: false, error: "disk full", lastSuccessAt: "2026-10-12T07:30:00.000Z" };
    writeFileSync(dataPath("backup-status.json"), JSON.stringify(status));
    const response = await GET();
    expect(await response.json()).toEqual({ status });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
