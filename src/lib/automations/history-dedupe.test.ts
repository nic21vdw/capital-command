import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { AUTOMATION_IDS } from "@/lib/automations/types";
import { pruneAutomationHistory, readAutomationHistory, recordAutomationEvent, resetAutomationHistoryMemory } from "@/lib/automations/history";
import { recordAutomationOutcome } from "@/lib/automations/store";

const now = new Date("2026-10-08T12:00:00.000Z");
const tick = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const blocked = {
  automationId: "publisher" as const, scope: "delivery" as const, kind: "blocked" as const, at: now.toISOString(),
  itemId: "clip1", destination: "tiktok", detail: "Clip (tiktok): 42 clips are already waiting in your TikTok inbox.", key: "clip1:tiktok::0:"
};

async function journal(name = "publisher-2026-10-08.jsonl"): Promise<Array<Record<string, unknown>>> {
  try {
    return (await readFile(dataPath("automations", "history", name), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await rm(dataPath("automations"), { recursive: true, force: true });
  resetAutomationHistoryMemory();
});
afterEach(() => vi.useRealTimers());

describe("journal writes only what changed", () => {
  it("writes a blocked item once while its state and message stay the same", async () => {
    for (let minutes = 0; minutes < 25; minutes += 5) {
      await recordAutomationEvent({ ...blocked, at: tick(minutes), nextAttemptAt: tick(minutes + 5) });
    }
    const lines = await journal();
    expect(lines).toHaveLength(1);
    expect(lines[0].at).toBe(tick(0));
  });

  it("writes again when the message changes, and again when it changes back", async () => {
    await recordAutomationEvent(blocked);
    await recordAutomationEvent({ ...blocked, at: tick(5) });
    await recordAutomationEvent({ ...blocked, at: tick(10), detail: "Clip (tiktok): 41 clips are already waiting in your TikTok inbox." });
    await recordAutomationEvent({ ...blocked, at: tick(15), detail: "Clip (tiktok): 41 clips are already waiting in your TikTok inbox." });
    await recordAutomationEvent({ ...blocked, at: tick(20) });
    expect((await journal()).map((line) => line.detail)).toEqual([
      blocked.detail,
      "Clip (tiktok): 41 clips are already waiting in your TikTok inbox.",
      blocked.detail
    ]);
  });

  it("writes again when the state changes", async () => {
    await recordAutomationEvent(blocked);
    await recordAutomationEvent({ ...blocked, at: tick(5), kind: "delivered", detail: "Clip (tiktok): published.", key: "clip1:tiktok:post1:1:" });
    await recordAutomationEvent({ ...blocked, at: tick(10), kind: "delivered", detail: "Clip (tiktok): published.", key: "clip1:tiktok:post1:1:" });
    expect((await journal()).map((line) => line.kind)).toEqual(["blocked", "delivered"]);
  });

  it("tracks each item and destination on its own", async () => {
    for (let minutes = 0; minutes < 15; minutes += 5) {
      for (const itemId of ["a", "b", "c"]) {
        for (const destination of ["tiktok", "youtube"]) {
          await recordAutomationEvent({ ...blocked, at: tick(minutes), itemId, destination, key: `${itemId}:${destination}::0:` });
        }
      }
    }
    expect(await journal()).toHaveLength(6);
  });

  it("keeps every retry attempt, because each one carries its own key", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await recordAutomationEvent({ ...blocked, kind: "retrying", at: tick(attempt), detail: "Clip (tiktok): temporary outage", key: `clip1:tiktok::${attempt}:${tick(attempt)}` });
    }
    expect(await journal()).toHaveLength(3);
  });

  it("records a worker outcome only when its result changes", async () => {
    const failed = { status: "failed" as const, detail: "3 stages need attention." };
    await recordAutomationOutcome("pipeline", { at: tick(0), ...failed });
    await recordAutomationOutcome("pipeline", { at: tick(2), ...failed });
    await recordAutomationOutcome("pipeline", { at: tick(4), ...failed });
    await recordAutomationOutcome("pipeline", { at: tick(6), status: "completed", detail: "All stages healthy." });
    await recordAutomationOutcome("pipeline", { at: tick(8), ...failed });
    expect((await journal("pipeline-2026-10-08.jsonl")).map((line) => line.kind)).toEqual(["failed", "completed", "failed"]);
  });

  it("writes a standing condition once on each new day", async () => {
    const tomorrow = (minutes: number) => new Date(Date.parse("2026-10-09T00:05:00.000Z") + minutes * 60_000).toISOString();
    await recordAutomationEvent({ ...blocked, at: tick(0) });
    await recordAutomationEvent({ ...blocked, at: tick(5) });
    await recordAutomationEvent({ ...blocked, at: tomorrow(0) });
    await recordAutomationEvent({ ...blocked, at: tomorrow(5) });
    expect(await journal("publisher-2026-10-08.jsonl")).toHaveLength(1);
    expect(await journal("publisher-2026-10-09.jsonl")).toHaveLength(1);
  });

  it("does not write the same line again after a restart", async () => {
    await recordAutomationEvent(blocked);
    resetAutomationHistoryMemory();
    await recordAutomationEvent({ ...blocked, at: tick(5) });
    await recordAutomationEvent({ ...blocked, at: tick(10), itemId: "clip2", key: "clip2:tiktok::0:" });
    resetAutomationHistoryMemory();
    await recordAutomationEvent({ ...blocked, at: tick(15), itemId: "clip2", key: "clip2:tiktok::0:" });
    expect(await journal()).toHaveLength(2);
  });

  it("writes the line again if the journal was deleted while the app ran", async () => {
    await recordAutomationEvent(blocked);
    await rm(dataPath("automations", "history"), { recursive: true, force: true });
    await recordAutomationEvent({ ...blocked, at: tick(5) });
    expect(await journal()).toHaveLength(1);
  });

  it("serves the same history to the screen as before", async () => {
    for (let minutes = 0; minutes < 25; minutes += 5) await recordAutomationEvent({ ...blocked, at: tick(minutes) });
    expect(await readAutomationHistory({}, new Date(tick(30)))).toMatchObject({ total: 1, counts: { delivered: 0, failed: 0, retrying: 0 } });
  });
});

describe("seven-day retention", () => {
  let clock = Date.parse("2026-10-08T13:00:00.000Z");
  const later = () => new Date((clock += 120_000));

  it("still deletes expired days when the event it was asked to record is a repeat", async () => {
    await recordAutomationEvent(blocked, later());
    await mkdir(dataPath("automations", "history"), { recursive: true });
    await writeFile(dataPath("automations", "history", "publisher-2026-09-30.jsonl"), "expired");
    await recordAutomationEvent({ ...blocked, at: tick(5) }, later());
    await expect(readFile(dataPath("automations", "history", "publisher-2026-09-30.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await journal()).toHaveLength(1);
  });

  it("keeps deleting the other expired days when one of them cannot be removed", async () => {
    const folder = dataPath("automations", "history");
    await mkdir(dataPath("automations", "history", "publisher-2026-09-27.jsonl"), { recursive: true });
    await writeFile(dataPath("automations", "history", "publisher-2026-09-28.jsonl"), "expired");
    await writeFile(dataPath("automations", "history", "threads-2026-09-29.jsonl"), "expired");
    await expect(recordAutomationEvent(blocked, later())).resolves.toBeUndefined();
    expect((await readdir(folder)).sort()).toEqual(["publisher-2026-09-27.jsonl", "publisher-2026-10-08.jsonl"]);
  });

  it("keeps the day seven days back and deletes the day before it, for every automation", async () => {
    const folder = dataPath("automations", "history");
    await mkdir(folder, { recursive: true });
    for (const id of AUTOMATION_IDS) {
      await writeFile(dataPath("automations", "history", `${id}-2026-10-01.jsonl`), "kept");
      await writeFile(dataPath("automations", "history", `${id}-2026-09-30.jsonl`), "expired");
    }
    await writeFile(dataPath("automations", "history", "publisher-2026-10-08.jsonl"), "today");
    await writeFile(dataPath("automations", "history", "notes.json"), "other");
    await writeFile(dataPath("automations", "history", "publisher-2026-9-30.jsonl"), "not a journal name");
    await pruneAutomationHistory(now);
    const remaining = (await readdir(folder)).sort();
    expect(remaining).toEqual([
      "ingest-2026-10-01.jsonl", "notes.json", "pipeline-2026-10-01.jsonl", "podcast-2026-10-01.jsonl",
      "publisher-2026-10-01.jsonl", "publisher-2026-10-08.jsonl", "publisher-2026-9-30.jsonl", "threads-2026-10-01.jsonl"
    ]);
  });

  it("does nothing when the history folder does not exist yet", async () => {
    await expect(pruneAutomationHistory(now)).resolves.toBeUndefined();
  });
});
