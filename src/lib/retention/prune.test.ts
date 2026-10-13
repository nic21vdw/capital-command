import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPruneReport, parsePruneArgs, pruneData } from "@/lib/retention/prune";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const created: string[] = [];

let data: string;

async function put(relative: string, bytes: number, ageMs: number) {
  const file = path.join(data, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.alloc(bytes));
  const when = new Date(NOW.getTime() - ageMs);
  await utimes(file, when, when);
  return file;
}

async function putJson(relative: string, value: unknown) {
  const file = path.join(data, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

async function ageDir(relative: string, ageMs: number) {
  const when = new Date(NOW.getTime() - ageMs);
  await utimes(path.join(data, relative), when, when);
}

async function exists(relative: string) {
  return stat(path.join(data, relative)).then(
    () => true,
    () => false
  );
}

function queueItem(overrides: Record<string, unknown>) {
  return {
    id: "q1",
    clipPath: "data/clips/outputs/elsewhere/clip-01.mp4",
    title: "t",
    caption: "c",
    hashtags: [],
    publishAt: "2026-10-20T12:00:00.000Z",
    visibility: "public",
    createdAt: "2026-10-01T00:00:00.000Z",
    platforms: { youtube: { status: "pending", attempts: 0 } },
    ...overrides
  };
}

async function seedStandardData() {
  await put("longform/work/p1/export-aaa-body.mp4", 1000, 30 * HOUR);
  await put("longform/work/p1/export-aaa-body-filter.txt", 10, 30 * HOUR);
  await put("longform/work/p1/export-bbb-merged.mp4", 500, 2 * HOUR);
  await put("longform/work/p1/export-ccc-hook.mp4", 700, 40 * HOUR);
  await put("longform/work/p1/source-audio.mp3", 300, 50 * DAY);
  await put("longform/outputs/p1/edited-aaa.mp4", 9000, 90 * DAY);
  await put("longform/outputs/p1/leftover.tmp", 40, 90 * DAY);
  await put("clips/sources/old-longform/video.mp4", 1700, 60 * DAY);
  await ageDir("clips/sources/old-longform", 60 * DAY);
  await putJson("longform/projects.json", [
    { id: "p1", sourceId: "src-longform", status: "ready", exports: [{ id: "ccc", status: "processing" }] },
    { id: "p2", sourceId: "old-longform", status: "processing", exports: [], updatedAt: "2026-10-12T00:00:00.000Z" }
  ]);

  await put("clips/uploads/j1/seg-01.mp4", 800, 3 * DAY);
  await put("clips/uploads/j1/caps-01.ass", 20, 3 * DAY);
  await put("clips/uploads/j1/export-zzz/subs.ass", 30, 3 * DAY);
  await put("clips/uploads/j1/source-audio.mp3", 100, 3 * DAY);
  await ageDir("clips/uploads/j1/export-zzz", 3 * DAY);

  await put("clips/sources/old-free/video.mp4", 5000, 60 * DAY);
  await put("clips/sources/old-free/meta.json", 50, 60 * DAY);
  await ageDir("clips/sources/old-free", 60 * DAY);
  await put("clips/sources/old-by-path/video.mp4", 4000, 60 * DAY);
  await ageDir("clips/sources/old-by-path", 60 * DAY);
  await put("clips/sources/old-by-jobid/video.mp4", 3000, 60 * DAY);
  await ageDir("clips/sources/old-by-jobid", 60 * DAY);
  await put("clips/sources/old-by-run/video.mp4", 2000, 60 * DAY);
  await ageDir("clips/sources/old-by-run", 60 * DAY);
  await put("clips/sources/old-busy/video.mp4", 1500, 60 * DAY);
  await ageDir("clips/sources/old-busy", 60 * DAY);
  await put("clips/sources/old-active-run/video.mp4", 1200, 60 * DAY);
  await ageDir("clips/sources/old-active-run", 60 * DAY);
  await put("clips/sources/recent/video.mp4", 6000, 5 * DAY);
  await ageDir("clips/sources/recent", 5 * DAY);
  await put("clips/sources/old-finished-job/video.mp4", 2500, 60 * DAY);
  await ageDir("clips/sources/old-finished-job", 60 * DAY);

  await putJson("clips/jobs.json", [
    { id: "job-by-id", sourceId: "old-by-jobid", status: "done", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "job-busy", sourceId: "old-busy", status: "processing", createdAt: "2026-10-12T00:00:00.000Z" },
    {
      id: "job-finished",
      sourceId: "old-finished-job",
      status: "done",
      createdAt: "2026-07-01T00:00:00.000Z",
      finishedAt: "2026-07-01T01:00:00.000Z"
    }
  ]);
  await putJson("pipeline/runs.json", [
    { id: "run-1", sourceId: "old-by-run", status: "running", clipJobId: "gone" },
    { id: "run-2", sourceId: "old-active-run", status: "running", updatedAt: "2026-10-12T00:00:00.000Z" }
  ]);
  await putJson("publish-queue.json", [
    queueItem({ id: "q-path", clipPath: "data/clips/sources/old-by-path/video.mp4" }),
    queueItem({ id: "q-job", jobId: "job-by-id" }),
    queueItem({ id: "q-run", runId: "run-1" })
  ]);

  await put("publish-queue.json.4321.1777000000000.tmp", 12_000, 3 * DAY);
  await put("pipeline/runs.json.99.1.tmp", 400, 30 * HOUR);
  await put("threads-queue.json.5.2.tmp", 90, 1 * HOUR);
}

beforeEach(async () => {
  data = await mkdtemp(path.join(os.tmpdir(), "prune-test-"));
  created.push(data);
  await seedStandardData();
});

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pruneData dry run", () => {
  it("lists what it would delete with sizes, and deletes nothing", async () => {
    const before = await readdir(data, { recursive: true });

    const report = await pruneData({ dataDir: data, apply: false, now: NOW });

    expect(await readdir(data, { recursive: true })).toEqual(before);
    expect(report.apply).toBe(false);
    expect(report.deleted).toEqual([]);
    const paths = report.candidates.map((item) => path.relative(data, item.path).replace(/\\/g, "/")).sort();
    expect(paths).toEqual(
      [
        "clips/sources/old-finished-job",
        "clips/sources/old-free",
        "clips/uploads/j1/caps-01.ass",
        "clips/uploads/j1/export-zzz",
        "clips/uploads/j1/seg-01.mp4",
        "longform/work/p1/export-aaa-body-filter.txt",
        "longform/work/p1/export-aaa-body.mp4",
        "pipeline/runs.json.99.1.tmp",
        "publish-queue.json.4321.1777000000000.tmp"
      ].sort()
    );
    expect(report.totalBytes).toBe(report.candidates.reduce((sum, item) => sum + item.bytes, 0));
    expect(report.totalBytes).toBe(1000 + 10 + 800 + 20 + 30 + 5050 + 2500 + 400 + 12_000);
  });

  it("prints every path and the total", async () => {
    const report = await pruneData({ dataDir: data, apply: false, now: NOW });
    const text = formatPruneReport(report);

    expect(text).toMatch(/dry run/i);
    expect(text).toContain("old-free");
    expect(text).toContain("export-aaa-body.mp4");
    expect(text).toMatch(/would delete 9 items/i);
    expect(text).toMatch(/--apply/);
  });
});

describe("pruneData --apply", () => {
  it("deletes exactly the dry-run candidates and nothing else", async () => {
    const dry = await pruneData({ dataDir: data, apply: false, now: NOW });
    const applied = await pruneData({ dataDir: data, apply: true, now: NOW });

    expect(applied.apply).toBe(true);
    expect(applied.deleted.map((item) => item.path).sort()).toEqual(dry.candidates.map((item) => item.path).sort());
    expect(applied.failed).toEqual([]);
    expect(applied.freedBytes).toBe(dry.totalBytes);
    for (const gone of [
      "longform/work/p1/export-aaa-body.mp4",
      "longform/work/p1/export-aaa-body-filter.txt",
      "clips/uploads/j1/seg-01.mp4",
      "clips/uploads/j1/caps-01.ass",
      "clips/uploads/j1/export-zzz",
      "clips/sources/old-free",
      "clips/sources/old-finished-job",
      "publish-queue.json.4321.1777000000000.tmp",
      "pipeline/runs.json.99.1.tmp"
    ]) {
      expect(await exists(gone)).toBe(false);
    }
  });

  it("keeps work files under 24 hours, caches, and the export that is still rendering", async () => {
    await pruneData({ dataDir: data, apply: true, now: NOW });

    expect(await exists("longform/work/p1/export-bbb-merged.mp4")).toBe(true);
    expect(await exists("longform/work/p1/source-audio.mp3")).toBe(true);
    expect(await exists("longform/work/p1/export-ccc-hook.mp4")).toBe(true);
    expect(await exists("clips/uploads/j1/source-audio.mp3")).toBe(true);
    expect(await exists("threads-queue.json.5.2.tmp")).toBe(true);
  });

  it("never touches longform/outputs, however old", async () => {
    await pruneData({ dataDir: data, apply: true, now: NOW, sourceDays: 1 });

    expect(await exists("longform/outputs/p1/edited-aaa.mp4")).toBe(true);
    expect(await exists("longform/outputs/p1/leftover.tmp")).toBe(true);
  });

  it("skips sources a queue item references by path, by job or by run", async () => {
    const report = await pruneData({ dataDir: data, apply: true, now: NOW });

    for (const kept of ["old-by-path", "old-by-jobid", "old-by-run"]) {
      expect(await exists(`clips/sources/${kept}/video.mp4`)).toBe(true);
      const skip = report.kept.find((entry) => entry.path.endsWith(kept));
      expect(skip?.reason).toMatch(/publish queue/i);
    }
  });

  it("skips sources with an unfinished clip job, an active run, or newer than the cutoff", async () => {
    const report = await pruneData({ dataDir: data, apply: true, now: NOW });

    expect(await exists("clips/sources/old-busy/video.mp4")).toBe(true);
    expect(report.kept.find((entry) => entry.path.endsWith("old-busy"))?.reason).toMatch(/clip job/i);
    expect(await exists("clips/sources/old-active-run/video.mp4")).toBe(true);
    expect(report.kept.find((entry) => entry.path.endsWith("old-active-run"))?.reason).toMatch(/run/i);
    expect(await exists("clips/sources/recent/video.mp4")).toBe(true);
  });

  it("skips a source a long-form project is still analysing", async () => {
    const report = await pruneData({ dataDir: data, apply: true, now: NOW });

    expect(await exists("clips/sources/old-longform/video.mp4")).toBe(true);
    expect(report.kept.find((entry) => entry.path.endsWith("old-longform"))?.reason).toMatch(/long-form/i);
  });

  it("honours --source-days", async () => {
    const report = await pruneData({ dataDir: data, apply: false, now: NOW, sourceDays: 3 });

    expect(report.candidates.some((item) => item.path.endsWith("recent"))).toBe(true);
    const wide = await pruneData({ dataDir: data, apply: false, now: NOW, sourceDays: 90 });
    expect(wide.candidates.some((item) => item.path.endsWith("old-free"))).toBe(false);
  });

  it("leaves every source alone when the publish queue cannot be read", async () => {
    await writeFile(path.join(data, "publish-queue.json"), "{ not json");

    const report = await pruneData({ dataDir: data, apply: true, now: NOW });

    expect(await exists("clips/sources/old-free/video.mp4")).toBe(true);
    expect(report.notes.join(" ")).toMatch(/publish queue/i);
    expect(await exists("longform/work/p1/export-aaa-body.mp4")).toBe(false);
  });

  it("leaves every source alone when there is no publish queue file", async () => {
    await rm(path.join(data, "publish-queue.json"));

    const report = await pruneData({ dataDir: data, apply: true, now: NOW });

    expect(await exists("clips/sources/old-free/video.mp4")).toBe(true);
    expect(report.notes.join(" ")).toMatch(/publish queue/i);
  });

  it("leaves every source alone when the publish queue lives in R2", async () => {
    const report = await pruneData({ dataDir: data, apply: true, now: NOW, queueBackend: "r2" });

    expect(await exists("clips/sources/old-free/video.mp4")).toBe(true);
    expect(report.notes.join(" ")).toMatch(/R2/);
  });

  it("is safe to run on an empty data folder", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "prune-empty-"));
    created.push(empty);

    const report = await pruneData({ dataDir: empty, apply: true, now: NOW });

    expect(report.candidates).toEqual([]);
    expect(report.totalBytes).toBe(0);
  });
});

describe("parsePruneArgs", () => {
  it("is a dry run unless --apply is passed", () => {
    expect(parsePruneArgs([])).toMatchObject({ apply: false, sourceDays: 30 });
    expect(parsePruneArgs(["--apply"])).toMatchObject({ apply: true });
  });

  it("reads --source-days and --data in either form", () => {
    expect(parsePruneArgs(["--source-days", "14"]).sourceDays).toBe(14);
    expect(parsePruneArgs(["--source-days=7"]).sourceDays).toBe(7);
    expect(parsePruneArgs(["--data", "C:/somewhere"]).dataDir).toBe("C:/somewhere");
  });

  it("rejects values that would delete everything or nothing sensible", () => {
    expect(() => parsePruneArgs(["--source-days", "abc"])).toThrow(/source-days/);
    expect(() => parsePruneArgs(["--source-days", "-1"])).toThrow(/source-days/);
    expect(() => parsePruneArgs(["--nope"])).toThrow(/--nope/);
  });
});
