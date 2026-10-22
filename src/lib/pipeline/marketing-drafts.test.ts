import { readFile, mkdir, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { draftOverview, retainedRuns, validateDraftSource } from "./marketing-drafts";
import { runListStatus } from "./status";
import type { PipelineRun } from "./types";
const faults = vi.hoisted(() => ({ save: false }));
vi.mock("@/lib/storage/atomic-json", async (original) => {
  const real = await original<typeof import("@/lib/storage/atomic-json")>();
  return { ...real, atomicWriteJson: (...args: Parameters<typeof real.atomicWriteJson>) => {
    if (faults.save) throw new Error("synthetic save failure");
    return real.atomicWriteJson(...args);
  } };
});

const globals = globalThis as typeof globalThis & { __pipelineRuns?: Map<string, PipelineRun>; __pipelineRunsLoaded?: boolean; __pipelineRunsLoading?: Promise<void>; __pipelinePersistQueue?: Promise<void> };
const command = { commandId: "synthetic_source_command_01", title: "Synthetic source", sourceUrl: "https://www.youtube.com/watch?v=synthetic01" };
beforeEach(async () => {
  vi.restoreAllMocks();
  faults.save = false;
  vi.resetModules();
  delete globals.__pipelineRuns;
  delete globals.__pipelineRunsLoaded;
  delete globals.__pipelineRunsLoading;
  delete globals.__pipelinePersistQueue;
  await mkdir(dataPath("pipeline"), { recursive: true });
  await writeFile(dataPath("pipeline", "runs.json"), "[]");
});

describe("source commands in the existing pipeline ledger", () => {
  it("persists a single inert source, replays across restart, and rejects changed arguments", async () => {
    let store = await import("./runs");
    const receipt = await store.createMarketingDraft("owner-one", command);
    const run = (await store.listRuns())[0];
    expect(run).toMatchObject({ id: receipt.id, status: "draft", name: command.title, sourceUrl: command.sourceUrl });
    expect(run.sourceId).toBeUndefined();
    expect(run.queueWhenReady).toBeUndefined();
    expect(run.clipJobId).toBeUndefined();
    expect(JSON.parse(await readFile(dataPath("pipeline", "runs.json"), "utf8"))).toHaveLength(1);
    delete globals.__pipelineRuns; delete globals.__pipelineRunsLoaded; vi.resetModules();
    store = await import("./runs");
    expect(await store.createMarketingDraft("owner-one", command)).toEqual({ ...receipt, replayed: true });
    await expect(store.createMarketingDraft("owner-one", { ...command, title: "Different" })).rejects.toThrow("different arguments");
    expect(await store.listRuns()).toHaveLength(1);
  });

  it("serializes simultaneous repeats without a second source", async () => {
    const store = await import("./runs");
    const receipts = await Promise.all(Array.from({ length: 12 }, () => store.createMarketingDraft("owner-one", command)));
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(receipts.filter((receipt) => !receipt.replayed)).toHaveLength(1);
    expect(await store.listRuns()).toHaveLength(1);
  });

  it("shares command serialization across separate Next route module graphs", async () => {
    const firstGraph = await import("./runs");
    vi.resetModules();
    const secondGraph = await import("./runs");
    const receipts = await Promise.all([
      firstGraph.createMarketingDraft("owner-one", command),
      secondGraph.createMarketingDraft("owner-one", command)
    ]);
    expect(receipts[0].id).toBe(receipts[1].id);
    expect(JSON.parse(await readFile(dataPath("pipeline", "runs.json"), "utf8"))).toHaveLength(1);
    expect(await firstGraph.listRuns()).toHaveLength(1);
  });

  it("does not acknowledge or retain a source when its atomic save fails", async () => {
    const store = await import("./runs");
    faults.save = true;
    await expect(store.createMarketingDraft("owner-one", command)).rejects.toThrow("synthetic save failure");
    expect(await store.listRuns()).toEqual([]);
    expect(await readFile(dataPath("pipeline", "runs.json"), "utf8")).toBe("[]");
    faults.save = false;
    expect((await store.createMarketingDraft("owner-one", command)).replayed).toBe(false);
  });

  it("keeps ownership and command namespaces separate", async () => {
    const store = await import("./runs");
    const a = await store.createMarketingDraft("owner-one", command);
    const b = await store.createMarketingDraft("owner-two", command);
    expect(a.id).not.toBe(b.id);
    expect((await store.getRun(a.id))?.marketingSource?.ownerId).toBe("owner-one");
  });

  it("retains receipts past legacy history limits and rejects legacy deletion or update", async () => {
    const store = await import("./runs");
    const first = await store.createMarketingDraft("owner-one", command);
    for (let i = 0; i < 32; i++) await store.createMarketingDraft("owner-one", { ...command, commandId: `synthetic_command_${String(i).padStart(3, "0")}` });
    expect((await store.createMarketingDraft("owner-one", command)).id).toBe(first.id);
    const run = (await store.getRun(first.id))!;
    await expect(store.deleteRun(first.id)).rejects.toThrow("cannot be deleted");
    await expect(store.updateRun(run, { queueWhenReady: true })).rejects.toThrow("authenticated marketing");
    expect(await store.listRuns()).toHaveLength(33);
  });

  it("does not replace malformed or unreadable source ledgers", async () => {
    await writeFile(dataPath("pipeline", "runs.json"), "{corrupt");
    const store = await import("./runs");
    await expect(store.createMarketingDraft("owner-one", command)).rejects.toThrow("read safely");
    await expect(store.listMarketingDrafts("owner-one")).rejects.toThrow("read safely");
    expect(await readFile(dataPath("pipeline", "runs.json"), "utf8")).toBe("{corrupt");
  });

  it("never advances, joins media or queues when reading a draft overview", async () => {
    const store = await import("./runs");
    const receipt = await store.createMarketingDraft("owner-one", command);
    const run = (await store.getRun(receipt.id))!;
    const queue = vi.fn(() => { throw new Error("must not read queue"); });
    const overview = await store.runOverview(run, { queue } as never);
    expect(overview).toEqual(draftOverview(run));
    expect(queue).not.toHaveBeenCalled();
    expect(overview.retryable).toEqual([]);
    expect(runListStatus(overview).label).toBe("Awaiting preparation");
  });

  it("retains all managed rows while limiting unrelated legacy history", () => {
    const row = { id: "managed", createdAt: "2020-01-01", marketingSource: { ownerId: "o" } } as PipelineRun;
    const rows = [row, ...Array.from({ length: 40 }, (_, i) => ({ id: String(i), createdAt: "2026-01-01" } as PipelineRun))];
    expect(retainedRuns(rows, 30)).toHaveLength(31);
    expect(retainedRuns(rows, 30)).toContain(row);
  });

  it.each(["http://youtu.be/synthetic01", "https://127.0.0.1/private", "file:///secret", "https://user:secret@youtu.be/synthetic01", "https://www.youtube.com/watch?v=synthetic01&token=secret", "https://vimeo.com/not-a-video"])("rejects unsupported source %s without persistence", async (sourceUrl) => {
    expect(() => validateDraftSource("owner-one", { ...command, sourceUrl })).toThrow();
    expect(await readFile(dataPath("pipeline", "runs.json"), "utf8")).toBe("[]");
  });
});
