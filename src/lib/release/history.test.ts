import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dataPath, dataRoot } from "@/lib/paths";
import { readUpdateHistory } from "./history";
import { formatUpdateDuration, slowestUpdateStep, type UpdateTiming } from "./timings";
import { GET } from "@/app/api/update/history/route";

function fixture(index = 0): UpdateTiming {
  return {
    id: index.toString(16).padStart(32, "0"),
    startedAt: new Date(Date.UTC(2026, 9, 3, 12, index)).toISOString(),
    finishedAt: new Date(Date.UTC(2026, 9, 3, 12, index, 10)).toISOString(),
    durationMs: 10_000, status: "completed",
    steps: [{ label: "Building and starting the new version", durationMs: 9_000, status: "completed",
      details: [{ label: "Compile build", durationMs: 8_000 }, { label: "Start server", durationMs: 1_000 }] }]
  };
}

beforeEach(async () => { await rm(dataPath("update-history"), { recursive: true, force: true }); });

describe("update history", () => {
  it("returns an empty history before the first recorded update", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ updates: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the newest 20 updates and ignores malformed, temporary and mismatched records", async () => {
    await mkdir(dataPath("update-history"), { recursive: true });
    for (let index = 0; index < 25; index++) {
      const update = fixture(index);
      await writeFile(dataPath("update-history", `${update.id}.json`), JSON.stringify(update));
    }
    await writeFile(dataPath("update-history", "f".repeat(32) + ".json"), "broken JSON");
    await writeFile(dataPath("update-history", "e".repeat(32) + ".json"), JSON.stringify(fixture()));
    await writeFile(dataPath("update-history", "d".repeat(32) + ".json.tmp"), JSON.stringify(fixture(50)));
    const updates = await readUpdateHistory();
    expect(updates).toHaveLength(20);
    expect(updates[0]).toEqual(fixture(24));
    expect(updates[19]).toEqual(fixture(5));
  });

  it("reports unreadable history instead of claiming there were no updates", async () => {
    await writeFile(dataPath("update-history"), "not a directory");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it.skipIf(process.platform !== "win32")("reads the actual Windows recorder, including child timings and failure", async () => {
    const driver = join(dataRoot(), "timing-fixture.ps1");
    const helper = join(process.cwd(), "scripts/update-timing.ps1").replace(/'/g, "''");
    await writeFile(driver, `. '${helper}'\nInitialize-UpdateTiming '${dataRoot().replace(/'/g, "''")}'\nStart-UpdateStep 'Checking this checkout'\nStart-Sleep -Milliseconds 40\nStart-UpdateStep 'Building and starting the new version (00m01s in, takes a few minutes)'\nAdd-UpdateTimingDetail '[update-timing] {"label":"Compile build","durationMs":1234}'\nAdd-UpdateTimingDetail '[update-timing] invalid'\nComplete-UpdateTiming 'failed'\n`);
    execFileSync("powershell.exe", ["-NoProfile", "-File", driver], {
      windowsHide: true, timeout: 20_000, env: { ...process.env, CAPITAL_COMMAND_DATA_DIR: dataRoot() }
    });
    const updates = await readUpdateHistory();
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("failed");
    expect(updates[0].finishedAt).not.toBeNull();
    expect(updates[0].steps[0].durationMs).toBeGreaterThanOrEqual(40);
    expect(updates[0].steps[1]).toMatchObject({
      label: "Building and starting the new version", status: "failed",
      details: [{ label: "Compile build", durationMs: 1234 }]
    });
    expect(updates[0].steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0)).toBeLessThanOrEqual(updates[0].durationMs!);
    const files = await readdir(dataPath("update-history"));
    expect(files.every((file) => file.endsWith(".json"))).toBe(true);
    expect(await readFile(dataPath("update-history", files[0]), "utf8")).not.toContain("invalid");
  }, 30_000);

  it("shows missing timings honestly and highlights the longest recorded step", () => {
    expect(formatUpdateDuration(null)).toBe("Not recorded");
    expect(formatUpdateDuration(0)).toBe("0 ms");
    expect(formatUpdateDuration(1234)).toBe("1.2s");
    expect(formatUpdateDuration(88_000)).toBe("1m 28s");
    const steps = fixture().steps;
    expect(slowestUpdateStep([...steps, { label: "Interrupted", durationMs: null, status: "running", details: [] }])).toEqual(steps[0]);
    expect(slowestUpdateStep([])).toBeNull();
  });
});
