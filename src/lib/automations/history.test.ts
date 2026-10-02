import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { historyDetail, readAutomationHistory, recordAutomationEvent } from "@/lib/automations/history";
import { recordAutomationOutcome, setAutomationPaused } from "@/lib/automations/store";

const now = new Date("2026-10-08T12:00:00.000Z");
const delivered = { automationId: "publisher" as const, scope: "delivery" as const, kind: "delivered" as const, at: now.toISOString(), detail: "YouTube confirmed publication." };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await rm(dataPath("automations"), { recursive: true, force: true });
});
afterEach(() => vi.useRealTimers());

describe("seven-day automation history", () => {
  it("starts empty without inventing earlier activity", async () => {
    expect(await readAutomationHistory()).toMatchObject({ events: [], total: 0, page: 1, pages: 1, counts: { delivered: 0, failed: 0, retrying: 0, workerIssues: 0 } });
  });

  it("keeps concurrent appends and deduplicates replayed delivery evidence", async () => {
    await Promise.all(Array.from({ length: 60 }, (_, index) => recordAutomationEvent({ ...delivered, itemId: `item-${index}`, key: String(index) })));
    await recordAutomationEvent({ ...delivered, itemId: "item-0", key: "0" });
    const first = await readAutomationHistory();
    const second = await readAutomationHistory({ page: 2 });
    expect(first).toMatchObject({ total: 60, pages: 2, counts: { delivered: 60 } });
    expect(first.events).toHaveLength(50);
    expect(second.events).toHaveLength(10);
    expect(new Set([...first.events, ...second.events].map((event) => event.id)).size).toBe(60);
  });

  it("counts delivery events separately from checks, handoffs and worker issues", async () => {
    await recordAutomationOutcome("publisher", { at: now.toISOString(), status: "completed", detail: "No due posts." });
    await recordAutomationOutcome("pipeline", { at: now.toISOString(), status: "failed", detail: "A pipeline stage failed." });
    await recordAutomationEvent({ ...delivered, kind: "retrying", nextAttemptAt: "2026-10-08T12:05:00.000Z" });
    await recordAutomationEvent({ ...delivered, kind: "failed" });
    await recordAutomationEvent({ ...delivered, kind: "scheduled" });
    await recordAutomationEvent(delivered);
    const activity = await readAutomationHistory({ kind: "activity" });
    expect(activity.counts).toEqual({ delivered: 1, retrying: 1, failed: 1, workerIssues: 1, scheduled: 1 });
    expect(activity.events).toHaveLength(5);
    expect(activity.events.some((event) => event.kind === "completed")).toBe(false);
    expect((await readAutomationHistory({ automationId: "pipeline" })).counts.delivered).toBe(0);
    const failures = await readAutomationHistory({ automationId: "publisher", kind: "failed" });
    expect(failures.events).toHaveLength(1);
    expect(failures.counts.delivered).toBe(1);
  });

  it("records changed pause controls once and persists the journal on disk", async () => {
    await setAutomationPaused("podcast", true);
    await setAutomationPaused("podcast", true);
    await setAutomationPaused("podcast", false);
    const history = await readAutomationHistory({ automationId: "podcast" });
    expect(history.events.map((event) => event.kind).sort()).toEqual(["paused", "resumed"]);
    const disk = await readFile(dataPath("automations", "history", "podcast-2026-10-08.jsonl"), "utf8");
    expect(disk.trim().split("\n")).toHaveLength(2);
  });

  it("excludes events older than seven days and future events, retaining the exact boundary", async () => {
    await recordAutomationEvent({ ...delivered, at: "2026-10-01T11:59:59.000Z" });
    await recordAutomationEvent({ ...delivered, at: "2026-10-01T12:00:00.000Z" });
    await recordAutomationEvent({ ...delivered, at: "2026-10-08T12:00:01.000Z" });
    expect((await readAutomationHistory()).events.map((event) => event.at)).toEqual(["2026-10-01T12:00:00.000Z"]);
  });

  it("prunes only expired journal files and leaves other files untouched", async () => {
    const folder = dataPath("automations", "history");
    await mkdir(folder, { recursive: true });
    await writeFile(dataPath("automations", "history", "publisher-2026-09-30.jsonl"), "expired");
    await writeFile(dataPath("automations", "history", "notes.json"), "preserve");
    await recordAutomationEvent(delivered, new Date(now.getTime() + 120_000));
    await expect(readFile(dataPath("automations", "history", "publisher-2026-09-30.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(dataPath("automations", "history", "notes.json"), "utf8")).toBe("preserve");
  });

  it("retains valid events around a damaged entry and declares incomplete counts", async () => {
    await recordAutomationEvent(delivered);
    await appendFile(dataPath("automations", "history", "publisher-2026-10-08.jsonl"), '{"broken":\n');
    await recordAutomationEvent({ ...delivered, kind: "retrying" });
    const history = await readAutomationHistory();
    expect(history.events).toHaveLength(2);
    expect(history.warnings).toEqual([expect.stringContaining("counts may be incomplete")]);
  });

  it("clamps pages when filters or retention remove earlier results", async () => {
    await recordAutomationEvent(delivered);
    expect(await readAutomationHistory({ page: 999 })).toMatchObject({ page: 1, pages: 1, total: 1 });
  });

  it("retains worker evidence even if the latest-outcome file cannot be replaced", async () => {
    await mkdir(dataPath("automations", "publisher-outcome.json"), { recursive: true });
    await expect(recordAutomationOutcome("publisher", { at: now.toISOString(), status: "failed", detail: "Publisher could not read its queue." })).rejects.toThrow();
    expect((await readAutomationHistory({ automationId: "publisher" })).counts.workerIssues).toBe(1);
  });

  it("bounds large journal reads and marks partial counts", async () => {
    await mkdir(dataPath("automations", "history"), { recursive: true });
    await writeFile(dataPath("automations", "history", "publisher-2026-10-08.jsonl"), `${" ".repeat(8 * 1024 * 1024 + 1024)}\n${JSON.stringify({ ...delivered, id: "latest" })}\n`);
    const history = await readAutomationHistory();
    expect(history.counts.delivered).toBe(1);
    expect(history.events[0].id).toBe("latest");
    expect(history.warnings).toEqual([expect.stringContaining("history read limit")]);
  });

  it("redacts credentials before persistence and again before returning stored entries", async () => {
    const detail = 'Bearer bearer-secret https://example.test?access_token=query-secret {"refresh_token":"json-secret"} client_secret=plain-secret https://user:password@example.test/path';
    await recordAutomationEvent({ ...delivered, detail });
    const disk = await readFile(dataPath("automations", "history", "publisher-2026-10-08.jsonl"), "utf8");
    for (const secret of ["bearer-secret", "query-secret", "json-secret", "plain-secret", "password"]) expect(disk).not.toContain(secret);
    await appendFile(dataPath("automations", "history", "publisher-2026-10-08.jsonl"), `${JSON.stringify({ ...delivered, id: "legacy", detail: "Bearer stored-secret" })}\n`);
    expect(JSON.stringify(await readAutomationHistory())).not.toContain("stored-secret");
    expect(historyDetail("a\u2014b")).toBe("a - b");
  });
});
