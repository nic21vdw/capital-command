import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import type { PipelineRun } from "./types";
import type { MarketingPreparationCommand, MarketingPreparationRecord } from "./marketing-preparation";

const faults = vi.hoisted(() => ({
  failSaveStatus: "", renderCalls: 0, renderThrows: false,
  renderWait: undefined as Promise<void> | undefined,
  renderStarted: undefined as (() => void) | undefined
}));
vi.mock("@/lib/storage/atomic-json", async (original) => {
  const real = await original<typeof import("@/lib/storage/atomic-json")>();
  return { ...real, atomicWriteJson: (...args: Parameters<typeof real.atomicWriteJson>) => {
    const rows = args[1] as PipelineRun[];
    if (Array.isArray(rows) && rows.some((run) => run.marketingSource?.preparations?.at(-1)?.status === faults.failSaveStatus)) {
      throw new Error("synthetic save failure");
    }
    return real.atomicWriteJson(...args);
  } };
});
vi.mock("@/lib/clipping/ffmpeg", async (original) => {
  const real = await original<typeof import("@/lib/clipping/ffmpeg")>();
  return { ...real, runFfmpeg: async (...args: Parameters<typeof real.runFfmpeg>) => {
    faults.renderCalls++;
    faults.renderStarted?.();
    await faults.renderWait;
    if (faults.renderThrows) throw new Error("synthetic renderer interruption");
    return real.runFfmpeg(...args);
  } };
});
// Explicit sentinels: the isolated adapter must not dispatch any full-pipeline
// worker, model, downloader or publication seam while producing a local proxy.
vi.mock("@/lib/clipping/download", () => ({
  downloadFullVideo: vi.fn(() => { throw new Error("network downloader forbidden"); }),
  fetchVideoMeta: vi.fn(() => { throw new Error("network metadata forbidden"); })
}));

type TestGlobal = typeof globalThis & {
  __pipelineRuns?: Map<string, PipelineRun>; __pipelineRunsLoaded?: boolean;
  __pipelineRunsLoading?: Promise<void>; __pipelinePersistQueue?: Promise<void>;
  __marketingPreparationWorker?: unknown;
};
const globals = globalThis as TestGlobal;
const ownerId = "synthetic-owner";
const sourceId = "synthetic-upload";
const access = { ownerId, sourceIds: new Set([sourceId]) };
const scope = { prepare: true, publish: false, schedule: false } as const;
const sourceRoot = dataPath("clips", "sources", sourceId);
const sourceFile = path.join(sourceRoot, "source.mp4");
let fixture: Buffer;

function resetProcess() {
  delete globals.__pipelineRuns; delete globals.__pipelineRunsLoaded;
  delete globals.__pipelineRunsLoading; delete globals.__pipelinePersistQueue;
  delete globals.__marketingPreparationWorker;
  vi.resetModules();
}

beforeAll(async () => {
  const ffmpeg = await vi.importActual<typeof import("@/lib/clipping/ffmpeg")>("@/lib/clipping/ffmpeg");
  await mkdir(sourceRoot, { recursive: true });
  await ffmpeg.runFfmpeg(["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12",
    "-t", "0.5", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", sourceFile]);
  fixture = await readFile(sourceFile);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  faults.failSaveStatus = ""; faults.renderCalls = 0; faults.renderThrows = false;
  faults.renderWait = undefined; faults.renderStarted = undefined;
  resetProcess();
  await mkdir(dataPath("pipeline"), { recursive: true });
  await writeFile(dataPath("pipeline", "runs.json"), "[]");
  await writeFile(sourceFile, fixture);
  await writeFile(path.join(sourceRoot, "meta.json"), JSON.stringify({
    id: sourceId, fileName: "synthetic-upload.mp4", storedName: "source.mp4", mime: "video/mp4",
    sizeBytes: fixture.length, durationSec: 0.5, width: 320, height: 180, hasAudio: false, createdAt: "2026-01-01T00:00:00Z"
  }));
});

async function setup() {
  const runs = await import("./runs");
  const preparation = await import("./marketing-preparation");
  const source = await runs.createMarketingDraft(ownerId, {
    commandId: "synthetic_source_create_01", title: "Synthetic uploaded recording",
    sourceUrl: "https://www.youtube.com/watch?v=synthetic01"
  });
  const command: MarketingPreparationCommand = { operation: "prepare_source", commandId: randomUUID(),
    runId: source.id, expectedRevision: 1, sourceId };
  return { runs, preparation, source, command };
}

async function diskRecord(): Promise<MarketingPreparationRecord | undefined> {
  const rows = JSON.parse(await readFile(dataPath("pipeline", "runs.json"), "utf8")) as PipelineRun[];
  return rows[0]?.marketingSource?.preparations?.at(-1);
}

describe("durable owner-scoped preparation in the original ledger", () => {
  it("saves immutable content-bound intent, increments revision once and replays across restart", async () => {
    const { preparation, runs, command } = await setup();
    const first = await preparation.requestMarketingPreparation(ownerId, command, access);
    expect(first).toMatchObject({ runId: command.runId, commandId: command.commandId, revision: 2, status: "requested", persisted: true, replayed: false });
    expect(await diskRecord()).toMatchObject({ command, snapshot: { revision: 1, source: {
      sourceId, sha256: createHash("sha256").update(fixture).digest("hex"), sizeBytes: fixture.length
    } }, history: [{ status: "requested" }] });
    expect((await runs.getRun(command.runId))!).toMatchObject({ status: "draft", marketingSource: { revision: 2 } });
    expect(faults.renderCalls).toBe(0);
    resetProcess();
    const reloaded = await import("./marketing-preparation");
    expect(await reloaded.requestMarketingPreparation(ownerId, command, access)).toEqual({ ...first, replayed: true });
    await expect(reloaded.requestMarketingPreparation(ownerId, { ...command, expectedRevision: 2 }, access)).rejects.toThrow("different arguments");
  });

  it("serializes duplicate commands across Next module graphs without duplicate claims or revisions", async () => {
    const { preparation, runs, command } = await setup();
    vi.resetModules();
    const other = await import("./marketing-preparation");
    const results = await Promise.all([preparation.requestMarketingPreparation(ownerId, command, access),
      other.requestMarketingPreparation(ownerId, command, access)]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect((await runs.getRun(command.runId))?.marketingSource?.preparations).toHaveLength(1);
  });

  it("checks trusted ownership before reading metadata/media and rejects missing source permission", async () => {
    const { preparation, command } = await setup();
    const sources = await import("@/lib/clipping/sources");
    const read = vi.spyOn(sources, "readSourceMeta");
    await expect(preparation.requestMarketingPreparation(ownerId, command, { ownerId, sourceIds: new Set() })).rejects.toThrow("not allowed");
    await expect(preparation.requestMarketingPreparation("other-owner", command, access)).rejects.toThrow("not allowed");
    expect(read).not.toHaveBeenCalled();
    expect(await diskRecord()).toBeUndefined();
    await expect(preparation.requestMarketingPreparation("other-owner", command, { ownerId: "other-owner", sourceIds: new Set([sourceId]) })).rejects.toThrow("not available");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects stale revisions, concurrent fresh commands and reused owner command ids", async () => {
    const { preparation, runs, command } = await setup();
    await expect(preparation.requestMarketingPreparation(ownerId, { ...command, expectedRevision: 2 }, access)).rejects.toThrow("revision changed");
    await preparation.requestMarketingPreparation(ownerId, command, access);
    await expect(preparation.requestMarketingPreparation(ownerId, { ...command, commandId: randomUUID(), expectedRevision: 2 }, access)).rejects.toThrow("in progress");
    const second = await runs.createMarketingDraft(ownerId, { commandId: "synthetic_second_source_01", title: "Second", sourceUrl: "https://youtu.be/synthetic01" });
    await expect(preparation.requestMarketingPreparation(ownerId, { ...command, runId: second.id }, access)).rejects.toThrow("different arguments");
  });

  it("does not acknowledge or retain a request whose atomic save failed", async () => {
    const { preparation, runs, command } = await setup();
    faults.failSaveStatus = "requested";
    await expect(preparation.requestMarketingPreparation(ownerId, command, access)).rejects.toThrow("synthetic save failure");
    expect(await diskRecord()).toBeUndefined();
    expect((await runs.getRun(command.runId))?.marketingSource?.revision).toBeUndefined();
    faults.failSaveStatus = "";
    expect((await preparation.requestMarketingPreparation(ownerId, command, access)).replayed).toBe(false);
  });

  it("requires an unforgeable preparation-only process permit before claiming", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    await expect(preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, {} as never)).rejects.toThrow("owning-process");
    expect(() => preparation.createMarketingPreparationPermit(ownerId, command, access, { ...scope, publish: true } as never)).toThrow("preparation-only");
    expect((await diskRecord())?.status).toBe("requested");
    expect(faults.renderCalls).toBe(0);
  });

  it("rejects expired or serialized permits without claiming or reading media", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    await expect(preparation.processMarketingPreparation(ownerId, command.runId, command.commandId,
      JSON.parse(JSON.stringify(permit)))).rejects.toThrow("owning-process");
    const future = Date.now() + 6 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(future);
    await expect(preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).rejects.toThrow("owning-process");
    expect((await diskRecord())?.status).toBe("requested");
    expect(faults.renderCalls).toBe(0);
  });

  it("renders an actual bounded proxy through the original FFmpeg seam, and preserves legacy exclusion", async () => {
    const { preparation, runs, command } = await setup();
    const longform = await import("@/lib/longform/store");
    const jobs = await import("@/lib/clipping/jobs");
    const podcast = await import("@/lib/podcast/schedule");
    const download = await import("@/lib/clipping/download");
    const ai = await import("@/lib/ai");
    const createProject = vi.spyOn(longform, "createProject").mockImplementation(async () => { throw new Error("full pipeline worker forbidden"); });
    const createJob = vi.spyOn(jobs, "createJobFromUpload").mockImplementation(async () => { throw new Error("full pipeline worker forbidden"); });
    const schedule = vi.spyOn(podcast, "scheduleEpisode").mockImplementation(async () => { throw new Error("scheduling forbidden"); });
    const model = vi.spyOn(ai, "runAi").mockImplementation(async () => { throw new Error("model invocation forbidden"); });
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    const result = await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit);
    expect(result).toMatchObject({ status: "prepared", persisted: true, output: { kind: "local_review_proxy", sourceId, durationSec: 0.5 } });
    expect(result.output!.sizeBytes).toBeGreaterThan(0);
    const proxy = path.join(sourceRoot, ...result.output!.fileName.split("/"));
    expect((await stat(proxy)).size).toBe(result.output!.sizeBytes);
    expect(createHash("sha256").update(await readFile(proxy)).digest("hex")).toBe(result.output!.sha256);
    expect((await diskRecord())?.history.map((step) => step.status)).toEqual(["requested", "claimed", "running", "prepared"]);
    // Optional durable proof from the real renderer; normal test runs remain
    // confined to the hermetic data directory selected by vitest.setup.ts.
    if (process.env.MARKETING_PREPARATION_EVIDENCE_DIR) {
      const evidence = process.env.MARKETING_PREPARATION_EVIDENCE_DIR;
      await mkdir(evidence, { recursive: true });
      await copyFile(proxy, path.join(evidence, "review-proxy.mp4"));
      await writeFile(path.join(evidence, "review-proxy-proof.json"), JSON.stringify({
        synthetic: true, renderer: "original runFfmpeg", receipt: result, ledger: await diskRecord(),
        assertions: { legacyStatus: "draft", downloads: 0, fullPipelineWorkers: 0, schedules: 0 }
      }, null, 2));
    }
    const run = (await runs.getRun(command.runId))!;
    expect(run.status).toBe("draft");
    expect(run.sourceId).toBeUndefined();
    expect(run.queueWhenReady).toBeUndefined();
    expect(run.unattended).toBeUndefined();
    // Defensive exclusion even if an old/invalid ledger carries a running state.
    await runs.advanceRun({ ...run, status: "running", sourceId, unattended: true });
    await runs.runOverview({ ...run, status: "running", sourceId, unattended: true });
    expect(createProject).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(download.downloadFullVideo).not.toHaveBeenCalled();
    expect(download.fetchVideoMeta).not.toHaveBeenCalled();
    expect(faults.renderCalls).toBe(1);
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "prepared", replayed: true });
    expect(faults.renderCalls).toBe(1);
    resetProcess();
    const reloaded = await import("./marketing-preparation");
    expect(await reloaded.requestMarketingPreparation(ownerId, command, access)).toMatchObject({ status: "prepared", replayed: true, output: result.output });
    expect(faults.renderCalls).toBe(1);
  });

  it("does not dispatch duplicate claims while a worker is in flight", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    let release!: () => void;
    faults.renderWait = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { faults.renderStarted = resolve; });
    const first = preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit);
    await started;
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "running", replayed: true });
    release();
    expect((await first).status).toBe("prepared");
    expect(faults.renderCalls).toBe(1);
  });

  it("keeps managed rows outside heartbeat and direct queue writes even with legacy scheduling flags", async () => {
    const { runs, command } = await setup();
    const run = (await runs.getRun(command.runId))!;
    Object.assign(run, { status: "running", sourceId, unattended: true, queueWhenReady: true,
      posts: [{ id: "synthetic-post", platform: "threads", text: "Must never be queued" }] });
    const queuePosts = await import("./queuePosts");
    const queueOutputs = await import("./queueOutputs");
    const threads = await import("@/lib/threads/queue");
    const mutate = vi.spyOn(threads, "mutateQueue");
    await expect(queuePosts.queueRunPosts(run.id)).rejects.toThrow("does not authorize scheduling");
    await expect(queueOutputs.planRunOutputs(run.id)).rejects.toThrow("publication authorization");
    expect(mutate).not.toHaveBeenCalled();
    const posts = vi.spyOn(queuePosts, "queueRunPosts");
    const outputs = vi.spyOn(queueOutputs, "queueReadyOutputs");
    const heartbeat = await import("./heartbeat");
    expect(await heartbeat.advancePipelineOnce()).toBe(0);
    expect(posts).not.toHaveBeenCalled();
    expect(outputs).not.toHaveBeenCalled();
    expect(faults.renderCalls).toBe(0);
  });

  it("rejects changed uploaded content after request without calling the renderer", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    await writeFile(sourceFile, Buffer.concat([fixture, Buffer.from("changed")]));
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "failed", error: expect.stringContaining("content changed") });
    expect(faults.renderCalls).toBe(0);
  });

  it("does not render when claim or running-state persistence fails", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    faults.failSaveStatus = "claimed";
    await expect(preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).rejects.toThrow("synthetic save failure");
    expect((await diskRecord())?.status).toBe("requested");
    expect(faults.renderCalls).toBe(0);
    faults.failSaveStatus = "running";
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "failed", error: expect.stringContaining("persist") });
    expect((await diskRecord())?.status).toBe("failed");
    expect(faults.renderCalls).toBe(0);
  });

  it("records an unacknowledged completed render as uncertain, never prepared or dispatched twice", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    faults.failSaveStatus = "prepared";
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "uncertain" });
    expect((await diskRecord())?.status).toBe("uncertain");
    expect((await diskRecord())?.output).toBeUndefined();
    faults.failSaveStatus = "";
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "uncertain", replayed: true });
    expect(faults.renderCalls).toBe(1);
  });

  it("durably reports a renderer failure and permits only a fresh explicit revision to retry", async () => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    faults.renderThrows = true;
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "failed" });
    expect((await diskRecord())?.status).toBe("failed");
    expect(await preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "failed", replayed: true });
    expect(faults.renderCalls).toBe(1);
    expect(await preparation.requestMarketingPreparation(ownerId, { ...command, commandId: randomUUID(), expectedRevision: 2 }, access)).toMatchObject({ status: "requested", revision: 3 });
  });

  it.each(["claimed", "running"] as const)("fences a %s command after a process restart", async (status) => {
    const { preparation, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const rows = JSON.parse(await readFile(dataPath("pipeline", "runs.json"), "utf8")) as PipelineRun[];
    Object.assign(rows[0].marketingSource!.preparations![0], { status, claim: { token: randomUUID(), workerInstance: "previous-process", at: new Date().toISOString() } });
    await writeFile(dataPath("pipeline", "runs.json"), JSON.stringify(rows));
    resetProcess();
    const next = await import("./marketing-preparation");
    const permit = next.createMarketingPreparationPermit(ownerId, command, access, scope);
    expect(await next.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).toMatchObject({ status: "uncertain", error: expect.stringContaining("fenced") });
    expect(faults.renderCalls).toBe(0);
    const retry = { ...command, commandId: randomUUID(), expectedRevision: 2 };
    expect(await next.requestMarketingPreparation(ownerId, retry, access)).toMatchObject({ revision: 3, status: "requested" });
  });

  it("fences a stale target before claim and preserves the original request", async () => {
    const { preparation, runs, command } = await setup();
    await preparation.requestMarketingPreparation(ownerId, command, access);
    const run = (await runs.getRun(command.runId))!;
    run.marketingSource!.revision = 3;
    const permit = preparation.createMarketingPreparationPermit(ownerId, command, access, scope);
    await expect(preparation.processMarketingPreparation(ownerId, command.runId, command.commandId, permit)).rejects.toThrow("revision");
    expect((await diskRecord())?.status).toBe("requested");
    expect(faults.renderCalls).toBe(0);
  });
});
