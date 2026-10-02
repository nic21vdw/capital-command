import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
import { isAutomationPaused, readAutomationControls, readAutomationOutcome, recordAutomationOutcome, setAutomationPaused } from "@/lib/automations/store";

beforeEach(async () => { await rm(dataPath("automations"), { recursive: true, force: true }); });

describe("durable automation controls", () => {
  it("leaves configured workers available when no override exists", async () => {
    expect(await isAutomationPaused("publisher")).toBe(false);
    expect(await readAutomationControls()).toEqual({});
  });

  it("persists pause and resume and preserves concurrent controls", async () => {
    await Promise.all([setAutomationPaused("publisher", true), setAutomationPaused("threads", true)]);
    expect(await isAutomationPaused("publisher")).toBe(true);
    expect(await isAutomationPaused("threads")).toBe(true);
    await setAutomationPaused("publisher", false);
    expect(await isAutomationPaused("publisher")).toBe(false);
    expect(await isAutomationPaused("threads")).toBe(true);
    const saved = JSON.parse(await readFile(dataPath("automations", "control.json"), "utf8"));
    expect(saved.publisher.changedAt).toMatch(/^\d{4}-/);
  });

  it("reads external changes on every worker check", async () => {
    await setAutomationPaused("ingest", true);
    await writeFile(dataPath("automations", "control.json"), JSON.stringify({ ingest: { paused: false, changedAt: null } }), "utf8");
    expect(await isAutomationPaused("ingest")).toBe(false);
  });

  it.each(["not JSON", '{"publisher":{"paused":"false","changedAt":null}}', '{"unexpected":{"paused":false,"changedAt":null}}'])("fails closed for invalid saved controls: %s", async (contents) => {
    await mkdir(dataPath("automations"), { recursive: true });
    await writeFile(dataPath("automations", "control.json"), contents, "utf8");
    expect(await isAutomationPaused("publisher")).toBe(true);
    expect(await isAutomationPaused("podcast")).toBe(true);
    await expect(readAutomationControls()).rejects.toThrow("could not be read");
    await expect(setAutomationPaused("publisher", false)).rejects.toThrow("could not be read");
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(contents);
  });

  it("reports only recorded outcomes and retains the last outcome on disk", async () => {
    expect(await readAutomationOutcome("publisher")).toBeNull();
    const outcome = { at: "2026-10-01T15:00:00.000Z", status: "failed" as const, detail: "Two uploads failed." };
    await recordAutomationOutcome("publisher", outcome);
    expect(await readAutomationOutcome("publisher")).toEqual(outcome);
  });
});
