import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelEditorExportCommandSchema, reconcileEditorExportCommandSchema, settleEditorExportCancellationCommandSchema,
  requestEditorExportCommandSchema, editorCommandSchema } from "./editor";
import { marketingEditorStateSchema } from "./editor-types";
import type { EditorTarget, EditorExportIntent } from "./editor-types";
import type { EditorAttemptInspection, EditorCancellationSettlement, EditorPreparationEvidence } from "./editor";
import type { ClipJob } from "@/lib/clipping/types";
import type { Principal } from "./safety";

const target = { projectId: "project-1", jobId: "job-1", clipId: "clip-1", revision: 0,
  digest: "a".repeat(64), renderSignature: "renderer1" };
describe("editor cancellation command boundary", () => {
  it.each(["cancel_editor_export", "reconcile_editor_export"])("accepts only the exact public %s request/attempt identity", (operation) => {
    const command = { operation, commandId: randomUUID(), target, requestId: randomUUID(), attemptId: randomUUID() };
    expect(editorCommandSchema.parse(command)).toEqual(command);
    for (const extra of [{ workerEpoch: randomUUID() }, { outcome: "canceled" }, { ownerId: "someone-else" }, { settled: true }]) {
      expect(editorCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
    }
  });
  it("keeps settlement outside the public union and requires the existing cancellation UUID", () => {
    const command = { operation: "settle_editor_export_cancellation", commandId: randomUUID(), target,
      requestId: randomUUID(), attemptId: randomUUID(), cancelCommandId: randomUUID() };
    expect(settleEditorExportCancellationCommandSchema.parse(command)).toEqual(command);
    expect(editorCommandSchema.safeParse(command).success).toBe(false);
    expect(settleEditorExportCancellationCommandSchema.safeParse({ ...command, outcome: "canceled" }).success).toBe(false);
  });
  it("requires UUIDs for exact cancellation/restart links and refuses target mutations", () => {
    const command = { operation: "cancel_editor_export", commandId: randomUUID(), target, requestId: randomUUID() };
    expect(cancelEditorExportCommandSchema.parse(command)).toEqual(command);
    expect(reconcileEditorExportCommandSchema.safeParse({ ...command, operation: "reconcile_editor_export", attemptId: "arbitrary" }).success).toBe(false);
    expect(cancelEditorExportCommandSchema.safeParse({ ...command, target: { ...target, ownerId: "foreign" } }).success).toBe(false);
    expect(requestEditorExportCommandSchema.safeParse({ operation: "request_editor_export", commandId: randomUUID(), target,
      supersedesRequestId: "not-a-uuid" }).success).toBe(false);
  });
  it("round-trips durable epoch, cancellation, reconciliation and one-to-one restart metadata on the original row", () => {
    const intent = { requestId: randomUUID(), revision: 0, digest: target.digest, renderSignature: target.renderSignature,
      state: "cancel_requested", attemptId: randomUUID(), workerEpoch: randomUUID(),
      cancellation: { commandId: randomUUID(), requestedAt: "2026-10-21T22:00:00.000Z" },
      reconciliation: { commandId: randomUUID(), reconciledAt: "2026-10-21T22:00:01.000Z", reason: "unconfirmed_attempt" },
      supersededByRequestId: randomUUID() };
    const state = { ownerId: "owner", jobId: "job-1", clipId: "clip-1", revision: 0,
      digest: target.digest, renderSignature: target.renderSignature, receipts: [], exports: [intent] };
    expect(marketingEditorStateSchema.parse(state)).toEqual(state);
  });
});

describe("durable original editor cancellation and explicit restart", () => {
  let root: string;
  let api: typeof import("./editor");
  let storage: typeof import("@/lib/storage/store");
  const owner: Principal = { ownerId: "fixture-owner", scopes: ["read", "write"] };
  const worker: Principal = { ownerId: "fixture-owner", scopes: ["worker"] };
  const binding = { ownerId: owner.ownerId, records: [{ projectId: "project-1", jobId: "job-1", clipId: "clip-1", sourceFile: "master.mp4" }] };
  const document = () => path.join(root, "capital-command.json");
  const jobsFile = () => path.join(root, "clips", "jobs.json");
  const disk = async () => JSON.parse(await readFile(document(), "utf8"));
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "editor-cancellation-"));
    vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in cancellation fixtures."); }));
    vi.resetModules();
    api = await import("./editor");
    storage = await import("@/lib/storage/store");
  });
  afterEach(async () => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("editor-cancellation-")) throw new Error("Invalid synthetic cleanup path.");
    // The original store snapshots asynchronously after its durable commit.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  async function fixture() {
    const { clipProjectSchema, appDataSchema } = await import("@/lib/storage/schemas");
    const { emptyData } = await import("@/lib/mockData/seed");
    const project = clipProjectSchema.parse({ id: "project-1", name: "Synthetic original cancellation project", jobId: "job-1",
      sourceFile: "master.mp4", baseDurationSec: 10, clipStart: 20, clipEnd: 30, trimStart: 0, trimEnd: 10,
      captions: [{ id: "caption-1", start: 0, end: 2, text: "Manual correction", words: [], enabled: true }],
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
    const job = { id: "job-1", fileName: "Synthetic", status: "done", stage: "done", progress: 100,
      clips: [{ id: "clip-1", file: "master.mp4", start: 20, end: 30 }] } as unknown as ClipJob;
    await mkdir(path.dirname(jobsFile()));
    await writeFile(document(), JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project] })));
    await writeFile(jobsFile(), JSON.stringify([job]));
    const registry = { epoch: randomUUID(), status: "active" as EditorAttemptInspection["status"] };
    const inspectionChecks = vi.fn();
    const ports = {
      getWorkerEpoch: vi.fn(() => registry.epoch), assertPreparationOnly: vi.fn(),
      readPreparation: vi.fn(async () => null as EditorPreparationEvidence | null),
      readCancellationSettlement: vi.fn(async () => null as EditorCancellationSettlement | null),
      inspectAttempt: vi.fn(async () => {
        const workerEpoch = registry.epoch, status = registry.status;
        return { workerEpoch, status, assertCurrent: () => {
          inspectionChecks();
          if (registry.epoch !== workerEpoch || registry.status !== status) throw new Error("Synthetic registry identity changed.");
        } };
      }),
      abortExact: vi.fn()
    };
    const readJob = vi.fn(api.readOriginalEditorJob);
    const store = { read: storage.readExistingAppData, mutate: storage.mutateExistingClipProject, readJob };
    const editor = new api.MarketingEditor({ binding, store, worker: ports });
    const snapshot = await editor.load(owner, "project-1");
    const request = { operation: "request_editor_export" as const, commandId: randomUUID(), target: snapshot.target };
    const pending = await editor.requestExport(owner, request);
    const cancel = (attemptId?: string, currentTarget = snapshot.target) => ({ operation: "cancel_editor_export" as const,
      commandId: randomUUID(), target: currentTarget, requestId: request.commandId, ...(attemptId ? { attemptId } : {}) });
    const claim = () => editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: snapshot.target, requestId: request.commandId });
    return { editor, snapshot, pending, request, cancel, claim, registry, ports, store, readJob, inspectionChecks };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function settlement(f: Fixture, attemptId: string, cancelCommandId: string): EditorCancellationSettlement {
    return { requestId: f.request.commandId, attemptId, workerEpoch: f.registry.epoch, cancelCommandId, settled: true, assertCurrent: vi.fn() };
  }
  function proof(f: Fixture, attemptId: string): EditorPreparationEvidence {
    return { requestId: f.request.commandId, attemptId, digest: f.snapshot.target.digest,
      renderSignature: f.snapshot.target.renderSignature, exportId: "synthetic-output", artifactSha256: "b".repeat(64), assertCurrent: vi.fn() };
  }
  function outcome(f: Fixture, attemptId: string) {
    return { operation: "record_editor_export_outcome" as const, commandId: randomUUID(), target: f.snapshot.target,
      requestId: f.request.commandId, attemptId, outcome: "prepared" as const };
  }
  function reconcile(f: Fixture, attemptId?: string, currentTarget = f.snapshot.target) {
    return { operation: "reconcile_editor_export" as const, commandId: randomUUID(), target: currentTarget,
      requestId: f.request.commandId, ...(attemptId ? { attemptId } : {}) };
  }
  function settle(f: Fixture, attemptId: string, cancelCommandId: string, currentTarget = f.snapshot.target) {
    return { operation: "settle_editor_export_cancellation" as const, commandId: randomUUID(), target: currentTarget,
      requestId: f.request.commandId, attemptId, cancelCommandId };
  }

  it("cancels undispatched work definitively without source reads, worker calls, dispatch or project revision changes", async () => {
    const f = await fixture();
    f.readJob.mockClear().mockImplementation(async () => { throw new Error("Source unavailable."); });
    await unlink(jobsFile());
    const command = f.cancel();
    const first = await f.editor.cancelExport(owner, command);
    expect(first).toEqual({ receipt: { commandId: command.commandId, operation: command.operation, revision: command.target.revision,
      digest: command.target.digest, renderSignature: command.target.renderSignature, requestId: command.requestId,
      state: "canceled", cancelCommandId: command.commandId, reviewInvalidated: true, publicationAuthorized: false },
    replayed: false, snapshot: null, reconciliation: { state: "refresh_required" } });
    expect(await f.editor.cancelExport(owner, command)).toEqual({ ...first, replayed: true });
    expect(f.readJob).not.toHaveBeenCalled();
    expect(f.ports.inspectAttempt).not.toHaveBeenCalled();
    expect(f.ports.abortExact).not.toHaveBeenCalled();
    expect((await disk()).clipProjects[0].marketingEditor.exports[0]).toMatchObject({ state: "canceled", cancellation: { commandId: command.commandId } });
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a claim after pending work was canceled, without assigning an attempt", async () => {
    const f = await fixture();
    await f.editor.cancelExport(owner, f.cancel());
    await expect(f.claim()).rejects.toMatchObject({ code: "conflict" });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].attemptId).toBeUndefined();
  });

  it("persists an active cancellation fence and its exact first UUID before any external abort or settlement", async () => {
    const f = await fixture(); const claimed = await f.claim();
    f.readJob.mockClear().mockImplementation(async () => { throw new Error("Projection must not delay abort."); });
    const command = f.cancel(claimed.attemptId);
    const result = await f.editor.cancelExport(owner, command);
    expect(result.receipt).toMatchObject({ state: "cancel_requested", attemptId: claimed.attemptId, cancelCommandId: command.commandId });
    expect(result.snapshot).toBeNull(); expect(result.reconciliation?.state).toBe("refresh_required");
    expect(f.readJob).not.toHaveBeenCalled(); expect(f.ports.abortExact).not.toHaveBeenCalled();
    const intent = (await disk()).clipProjects[0].marketingEditor.exports[0];
    expect(intent).toMatchObject({ state: "cancel_requested", workerEpoch: f.registry.epoch, cancellation: { commandId: command.commandId } });
    const second = await f.editor.cancelExport(owner, f.cancel(claimed.attemptId));
    expect(second.receipt.cancelCommandId).toBe(command.commandId);
    expect((await f.editor.cancelExport(owner, command)).receipt).toEqual(result.receipt);
    expect((await f.editor.list(owner))[0].deleteTarget.revision).toBe(command.target.revision);
  });

  it("requires a trusted epoch for a new claim and never accepts one from the command", async () => {
    const f = await fixture();
    const claim = { operation: "claim_editor_export" as const, commandId: randomUUID(), target: f.snapshot.target, requestId: f.request.commandId };
    for (const getWorkerEpoch of [undefined, () => "invalid"] ) {
      const editor = new api.MarketingEditor({ binding, store: f.store, worker: { ...f.ports, getWorkerEpoch } });
      await expect(editor.claimExport(worker, claim)).rejects.toMatchObject({ code: "unavailable" });
    }
    await expect(f.editor.claimExport(worker, { ...claim, workerEpoch: randomUUID() } as typeof claim)).rejects.toMatchObject({ code: "invalid" });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("pending_dispatch");
  });

  it("returns no fence and performs no external abort when persistence fails", async () => {
    const f = await fixture(); const claimed = await f.claim();
    const before = await readFile(document(), "utf8");
    const editor = new api.MarketingEditor({ binding, worker: f.ports, store: { ...f.store, mutate: async (_id, update) => {
      update(structuredClone((await disk()).clipProjects[0])); throw new Error("Synthetic atomic commit failure.");
    } } });
    await expect(editor.cancelExport(owner, f.cancel(claimed.attemptId))).rejects.toThrow("Synthetic atomic commit failure");
    expect(await readFile(document(), "utf8")).toBe(before);
    expect(f.ports.abortExact).not.toHaveBeenCalled(); expect(f.ports.readCancellationSettlement).not.toHaveBeenCalled();
  });

  it("confirms canceled only from matching trusted settlement and keeps the original cancel receipt immutable", async () => {
    const f = await fixture(); const claimed = await f.claim(); const cancel = f.cancel(claimed.attemptId);
    const first = await f.editor.cancelExport(owner, cancel);
    const evidence = settlement(f, claimed.attemptId, cancel.commandId);
    f.ports.readCancellationSettlement.mockResolvedValue(evidence);
    const command = settle(f, claimed.attemptId, cancel.commandId);
    await expect(f.editor.settleExportCancellation(owner, command)).rejects.toMatchObject({ code: "forbidden" });
    const stopped = await f.editor.settleExportCancellation(worker, command);
    expect(stopped.receipt.state).toBe("canceled"); expect(stopped.snapshot).toBeNull();
    expect(evidence.assertCurrent).toHaveBeenCalledOnce();
    expect((await f.editor.cancelExport(owner, cancel)).receipt).toEqual(first.receipt);
    expect((await f.editor.settleExportCancellation(worker, command)).receipt).toEqual(stopped.receipt);
    f.ports.readPreparation.mockResolvedValue(proof(f, claimed.attemptId));
    await expect(f.editor.recordExportOutcome(worker, outcome(f, claimed.attemptId))).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps an active unconfirmed stop requested, but marks missing or prior ownership uncertain", async () => {
    const f = await fixture(); const claimed = await f.claim(); const cancel = f.cancel(claimed.attemptId);
    await f.editor.cancelExport(owner, cancel);
    expect((await f.editor.settleExportCancellation(worker, settle(f, claimed.attemptId, cancel.commandId))).receipt.state).toBe("cancel_requested");
    f.registry.status = "missing";
    expect((await f.editor.settleExportCancellation(worker, settle(f, claimed.attemptId, cancel.commandId))).receipt.state).toBe("uncertain");
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].reconciliation).toBeUndefined();
    f.registry.epoch = randomUUID(); f.registry.status = "prior_epoch";
    const result = await f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId));
    expect(result.receipt.state).toBe("uncertain");
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].reconciliation.reason).toBe("unconfirmed_attempt");
  });

  it("reconciles a slow child close from matching trusted proof without rewriting the first settlement receipt", async () => {
    const f = await fixture(); const claimed = await f.claim(); const cancel = f.cancel(claimed.attemptId);
    const requested = await f.editor.cancelExport(owner, cancel);
    const internal = settle(f, claimed.attemptId, cancel.commandId);
    const first = await f.editor.settleExportCancellation(worker, internal);
    expect(first.receipt.state).toBe("cancel_requested");
    f.registry.status = "settled";
    f.ports.readCancellationSettlement.mockResolvedValue(settlement(f, claimed.attemptId, cancel.commandId));
    const command = reconcile(f, claimed.attemptId);
    const later = await f.editor.reconcileExport(owner, command);
    expect(later.receipt.state).toBe("canceled");
    expect((await f.editor.settleExportCancellation(worker, internal)).receipt).toEqual(first.receipt);
    expect((await f.editor.cancelExport(owner, cancel)).receipt).toEqual(requested.receipt);
    expect((await f.editor.reconcileExport(owner, command)).receipt).toEqual(later.receipt);
    expect((await disk()).clipProjects[0].marketingEditor.exports).toHaveLength(1);
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("canceled");
  });

  it("refuses foreign settlement identities and rechecks settlement at the locked commit", async () => {
    const f = await fixture(); const claimed = await f.claim(); const cancel = f.cancel(claimed.attemptId);
    await f.editor.cancelExport(owner, cancel);
    const valid = settlement(f, claimed.attemptId, cancel.commandId);
    for (const field of ["requestId", "attemptId", "workerEpoch", "cancelCommandId"] as const) {
      f.ports.readCancellationSettlement.mockResolvedValue({ ...valid, [field]: randomUUID() });
      await expect(f.editor.settleExportCancellation(worker, settle(f, claimed.attemptId, cancel.commandId))).rejects.toMatchObject({ code: "conflict" });
      await expect(f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId))).rejects.toMatchObject({ code: "conflict" });
    }
    f.ports.readCancellationSettlement.mockResolvedValue({ ...valid, assertCurrent: () => { throw new Error("Worker settlement changed before CAS."); } });
    await expect(f.editor.settleExportCancellation(worker, settle(f, claimed.attemptId, cancel.commandId))).rejects.toThrow("before CAS");
    await expect(f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId))).rejects.toThrow("before CAS");
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("cancel_requested");
  });

  it("fences completion that was already reading output proof when cancellation commits", async () => {
    const f = await fixture(); const claimed = await f.claim();
    let release!: () => void, began!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reading = new Promise<void>((resolve) => { began = resolve; });
    const evidence = proof(f, claimed.attemptId);
    f.ports.readPreparation.mockImplementation(async () => { began(); await gate; return evidence; });
    const late = f.editor.recordExportOutcome(worker, outcome(f, claimed.attemptId));
    await reading;
    await f.editor.cancelExport(owner, f.cancel(claimed.attemptId));
    release();
    await expect(late).rejects.toMatchObject({ code: "conflict" });
    expect(evidence.assertCurrent).not.toHaveBeenCalled();
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("cancel_requested");
  });

  it("preserves a prepared committed result through cancel and restart reconciliation without source reads", async () => {
    const f = await fixture(); const claimed = await f.claim();
    f.ports.readPreparation.mockResolvedValue(proof(f, claimed.attemptId));
    const prepared = await f.editor.recordExportOutcome(worker, outcome(f, claimed.attemptId));
    const before = (await disk()).clipProjects[0].marketingEditor.exports[0];
    f.readJob.mockClear().mockImplementation(async () => { throw new Error("Prepared media source is gone."); });
    expect((await f.editor.cancelExport(owner, f.cancel(claimed.attemptId))).receipt.state).toBe("prepared");
    expect((await f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId))).receipt.state).toBe("prepared");
    expect((await disk()).clipProjects[0].marketingEditor.exports[0]).toEqual(before);
    expect(prepared.receipt.state).toBe("prepared");
    expect(f.ports.inspectAttempt).not.toHaveBeenCalled(); expect(f.ports.abortExact).not.toHaveBeenCalled(); expect(f.readJob).not.toHaveBeenCalled();
  });

  it("serializes competing pending cancellation and claim without dispatching canceled work", async () => {
    const f = await fixture();
    vi.resetModules(); const { MarketingEditor } = await import("./editor");
    const other = new MarketingEditor({ binding, worker: f.ports });
    const results = await Promise.allSettled([f.editor.cancelExport(owner, f.cancel()), other.claimExport(worker, {
      operation: "claim_editor_export", commandId: randomUUID(), target: f.snapshot.target, requestId: f.request.commandId })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const intent = (await disk()).clipProjects[0].marketingEditor.exports[0];
    expect(["canceled", "claimed"]).toContain(intent.state);
    if (intent.state === "canceled") expect(intent.attemptId).toBeUndefined(); else expect(intent.cancellation).toBeUndefined();
  });

  it("rejects stale, foreign, wrong-attempt and deleted targets while exact receipts replay after deletion/restart", async () => {
    const f = await fixture(); const claimed = await f.claim(); const cancel = f.cancel(claimed.attemptId);
    const first = await f.editor.cancelExport(owner, cancel);
    await expect(f.editor.cancelExport({ ...owner, ownerId: "foreign" }, cancel)).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.editor.cancelExport(owner, { ...f.cancel(claimed.attemptId), attemptId: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.editor.cancelExport(owner, { ...f.cancel(claimed.attemptId), target: { ...target, projectId: "unlisted" } })).rejects.toMatchObject({ code: "forbidden" });
    const snapshot = await f.editor.load(owner, "project-1");
    await f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "New local revision" } });
    await expect(f.editor.cancelExport(owner, f.cancel(claimed.attemptId))).rejects.toMatchObject({ code: "conflict" });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("cancel_requested");
    const current = (await f.editor.list(owner))[0].deleteTarget;
    await f.editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: current });
    await unlink(jobsFile());
    vi.resetModules(); const { MarketingEditor } = await import("./editor");
    const restarted = new MarketingEditor({ binding });
    expect(await restarted.cancelExport(owner, cancel)).toEqual({ ...first, replayed: true });
    await expect(restarted.cancelExport(owner, { ...cancel, commandId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    await expect(restarted.cancelExport(owner, { ...cancel, target: { ...cancel.target, revision: 100 } })).rejects.toMatchObject({ code: "conflict" });
  });

  it.each(["original", "explicit"])("retains the exact cancellation fence through %s deletion while invalidating readiness", async (kind) => {
    const f = await fixture(); const claimed = await f.claim(); const cancel = f.cancel(claimed.attemptId);
    const first = await f.editor.cancelExport(owner, cancel);
    const before = (await disk()).clipProjects[0].marketingEditor.exports[0];
    if (kind === "original") await storage.mutateAppData((data) => ({ ...data, clipProjects: [] }));
    else await f.editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: f.snapshot.target });
    const deleted = (await disk()).clipProjects[0];
    expect(deleted.marketingEditor.deletedAt).toEqual(expect.any(String));
    expect(deleted.marketingEditor.exports[0]).toEqual({ ...before, state: "stale" });
    expect(await f.editor.cancelExport(owner, cancel)).toEqual({ ...first, replayed: true });
    await expect(f.editor.cancelExport(owner, f.cancel(claimed.attemptId))).rejects.toMatchObject({ code: "not_found" });
    const evidence = proof(f, claimed.attemptId); f.ports.readPreparation.mockResolvedValue(evidence);
    await expect(f.editor.recordExportOutcome(worker, outcome(f, claimed.attemptId))).rejects.toMatchObject({ code: "not_found" });
    expect(evidence.assertCurrent).not.toHaveBeenCalled();
  });

  it("keeps cancellation and uncertainty fences across normal edits and no-op saves", async () => {
    const f = await fixture(); const claimed = await f.claim(); await f.editor.cancelExport(owner, f.cancel(claimed.attemptId));
    let snapshot = await f.editor.load(owner, "project-1");
    await f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target, project: snapshot.project });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("cancel_requested");
    f.registry.status = "missing";
    let current = (await f.editor.list(owner))[0].deleteTarget;
    await f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId, current));
    snapshot = await f.editor.load(owner, "project-1");
    await f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "Uncertainty survives this edit" } });
    await storage.mutateAppData((data) => { data.clipProjects[0].title = "Original legacy writer change"; return data; });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("uncertain");
    current = (await f.editor.list(owner))[0].deleteTarget;
    await expect(f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: current })).rejects.toMatchObject({ code: "conflict" });
  });

  it("retains definitive cancellation through edits and allows only an explicit fresh export request", async () => {
    const f = await fixture(); await f.editor.cancelExport(owner, f.cancel());
    const snapshot = await f.editor.load(owner, "project-1");
    const saved = await f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "New edit after cancellation" } });
    expect((await disk()).clipProjects[0].marketingEditor.exports).toHaveLength(1);
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("canceled");
    const fresh = await f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: saved.snapshot!.target });
    expect(fresh.receipt.state).toBe("pending_dispatch");
    expect((await disk()).clipProjects[0].marketingEditor.exports[1].attemptId).toBeUndefined();
  });

  it("refuses supersession before explicit reconciliation or without a trusted current inspection", async () => {
    const f = await fixture(); const claimed = await f.claim();
    await f.editor.recordExportOutcome(worker, { ...outcome(f, claimed.attemptId), outcome: "uncertain" });
    const restart = { operation: "request_editor_export" as const, commandId: randomUUID(), target: f.snapshot.target, supersedesRequestId: f.request.commandId };
    await expect(f.editor.requestExport(owner, restart)).rejects.toMatchObject({ code: "conflict" });
    f.registry.status = "missing";
    await f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId));
    const disconnected = new api.MarketingEditor({ binding, store: f.store });
    await expect(disconnected.requestExport(owner, restart)).rejects.toMatchObject({ code: "unavailable" });
    expect((await disk()).clipProjects[0].marketingEditor.exports).toHaveLength(1);
  });

  it("reconciles a prior process explicitly and links one fresh request without reusing its attempt", async () => {
    const f = await fixture(); const claimed = await f.claim();
    f.registry.epoch = randomUUID(); f.registry.status = "prior_epoch";
    const reconciliation = await f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId));
    expect(reconciliation.receipt.state).toBe("uncertain");
    const restart = { operation: "request_editor_export" as const, commandId: randomUUID(), target: f.snapshot.target, supersedesRequestId: f.request.commandId };
    const fresh = await f.editor.requestExport(owner, restart);
    const intents: EditorExportIntent[] = (await disk()).clipProjects[0].marketingEditor.exports;
    expect(intents).toHaveLength(2);
    expect(intents[0]).toMatchObject({ state: "uncertain", attemptId: claimed.attemptId, supersededByRequestId: restart.commandId });
    expect(intents[1]).toMatchObject({ state: "pending_dispatch", requestId: restart.commandId, supersedesRequestId: f.request.commandId });
    expect(intents[1].attemptId).toBeUndefined();
    expect((await f.editor.requestExport(owner, restart)).receipt).toEqual(fresh.receipt);
    await expect(f.editor.requestExport(owner, { ...restart, commandId: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    f.registry.status = "active";
    const next = await f.editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: f.snapshot.target, requestId: restart.commandId });
    expect(next.attemptId).not.toBe(claimed.attemptId);
    expect((await disk()).clipProjects[0].marketingEditor.exports[1].workerEpoch).toBe(f.registry.epoch);
    f.ports.readPreparation.mockResolvedValue(proof(f, claimed.attemptId));
    await expect(f.editor.recordExportOutcome(worker, outcome(f, claimed.attemptId))).rejects.toMatchObject({ code: "conflict" });
  });

  it("does not supersede same-epoch owned work, including ownership changes just before locked commit", async () => {
    const f = await fixture(); const claimed = await f.claim();
    f.registry.status = "missing";
    await f.editor.reconcileExport(owner, reconcile(f, claimed.attemptId));
    const restart = { operation: "request_editor_export" as const, commandId: randomUUID(), target: f.snapshot.target, supersedesRequestId: f.request.commandId };
    f.registry.status = "active";
    await expect(f.editor.requestExport(owner, restart)).rejects.toMatchObject({ code: "conflict" });
    f.registry.status = "missing";
    const editor = new api.MarketingEditor({ binding, worker: f.ports, store: { ...f.store, mutate: async (id, update) => {
      f.registry.status = "active"; return f.store.mutate(id, update);
    } } });
    await expect(editor.requestExport(owner, restart)).rejects.toThrow("registry identity changed");
    expect((await disk()).clipProjects[0].marketingEditor.exports).toHaveLength(1);
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].supersededByRequestId).toBeUndefined();
  });
});
