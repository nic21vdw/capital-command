import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorExportIntent, EditorTarget } from "./editor-types";
import type { EditorPreparationEvidence } from "./editor";
import type { Principal } from "./safety";

const owner: Principal = { ownerId: "dispatch-owner", scopes: ["read", "write"] };
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "editor-dispatch-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Dispatch fixtures forbid network"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const httpRequest = (user = "owner", method = "GET", headers?: HeadersInit) => new Request("http://127.0.0.1:3100/api/marketing/workspace", {
  method, headers: { "x-fixture-user": user, ...headers },
});
const httpCommand = (body: unknown, user = "owner") => new Request("http://127.0.0.1:3100/api/marketing/operations", {
  method: "POST", headers: { "x-fixture-user": user, "content-type": "application/json", origin: "http://127.0.0.1:3100" }, body: JSON.stringify(body),
});
const exportCommand = (target: EditorTarget) => ({ operation: "request_editor_export" as const, commandId: randomUUID(), target });
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
};

async function fixture(dispatch = true, creation = false) {
  const { clipProjectSchema, appDataSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const storage = await import("@/lib/storage/store");
  const { MarketingEditor, readOriginalEditorJob } = await import("./editor");
  const { createEditorExportDispatcher } = await import("./editor-dispatch");
  const { composeMarketingParity } = await import("./composition");
  const { createExistingRecordReader } = await import("./records");
  const { createMarketingHttpHandlers } = await import("./http");
  const { createMarketingResourceHandlers } = await import("./resources-http");
  const { isSameOriginLoopbackMutation } = await import("./auth");
  const project = clipProjectSchema.parse({ id: "project", jobId: "job", sourceFile: "master.mp4", name: "Synthetic dispatcher",
    baseDurationSec: 2, clipStart: 10, clipEnd: 12, trimStart: 0, trimEnd: 2,
    captions: [{ id: "caption", start: 0, end: 1, text: "Synthetic caption", words: [], enabled: true }],
    createdAt: "2026-10-21T12:00:00.000Z", updatedAt: "2026-10-21T12:00:00.000Z" });
  const binding = { ownerId: owner.ownerId, records: [{ projectId: "project", jobId: "job", clipId: "clip", sourceFile: "master.mp4" }] };
  const document = path.join(root, "capital-command.json"), jobs = path.join(root, "clips", "jobs.json");
  const source = path.join(root, "clips", "outputs", "job", "master.mp4");
  await mkdir(path.dirname(source), { recursive: true }); await writeFile(source, "synthetic-source-bytes");
  await writeFile(document, JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project, { ...project, id: "unlisted" }] })));
  await writeFile(jobs, JSON.stringify([{ id: "job", fileName: "Synthetic", status: "queued", progress: 0, stage: "downloading", notices: [],
    sourceUrl: "upload://synthetic", createdAt: project.createdAt, clips: [{ id: "clip", start: 10, end: 12, file: "master.mp4" }] }]));
  const originalFiles = [jobs, path.join(root, "publish-queue.json"), path.join(root, "threads-queue.json"), path.join(root, "provider-records.json")];
  for (const file of originalFiles.slice(1)) await writeFile(file, JSON.stringify({ fixture: true, enabled: true, scheduledAt: "2026-10-21T12:00:00.000Z" }));
  const before = await Promise.all(originalFiles.map((file) => readFile(file, "utf8")));
  const store = { read: storage.readExistingAppData, mutate: vi.fn(storage.mutateExistingClipProject), readJob: readOriginalEditorJob, createFromRoot: storage.createClipProjectFromRoot };
  const epoch = randomUUID();
  const worker = {
    assertPreparationOnly: vi.fn(), getWorkerEpoch: () => epoch,
    prepare: vi.fn(async (_projectId: string, _requestId: string, _attemptId: string): Promise<unknown> => ({ ignoredProof: true })),
    readPreparation: vi.fn(async (_project: unknown, intent: Readonly<EditorExportIntent>): Promise<EditorPreparationEvidence | null> => ({
      requestId: intent.requestId, attemptId: intent.attemptId!, digest: intent.digest, renderSignature: intent.renderSignature,
      exportId: "synthetic-proof", artifactSha256: "a".repeat(64), assertCurrent() {},
    })),
    readCurrentArtifact: vi.fn(async () => {
      const state = (await store.read())!.clipProjects[0].marketingEditor!;
      return { file: source, projectDigest: state.digest, renderSignature: state.renderSignature, assertCurrent() {} };
    }),
    abortExact: vi.fn(async (_projectId: string, _requestId: string, _attemptId: string, _cancelId: string) => {}),
    inspectAttempt: vi.fn(async () => ({ workerEpoch: epoch, status: "missing" as const, assertCurrent() {} })),
    readCancellationSettlement: vi.fn(async () => null),
  };
  const editor = new MarketingEditor({ binding, store, worker, ...(creation ? { creationPolicy: () => ({
    id: "synthetic-policy", version: "v1", ownerId: owner.ownerId, roots: [{ ...binding.records[0],
      sourceSha256: createHash("sha256").update("synthetic-source-bytes").digest("hex"), maxCreatedProjects: 2 }],
  }) } : {}) });
  const dispatcher = createEditorExportDispatcher({ binding, editor, worker });
  const dispatchOnce = vi.spyOn(dispatcher, "dispatchOnce");
  const records = createExistingRecordReader({ resolveScope: (id) => id === owner.ownerId ? {
    ownerId: id, sourceIds: [], runIds: [], clipJobIds: ["job"], queueIds: [], accountIds: {},
  } : null });
  const base = { workspace: vi.fn(async () => ({ jobs: [], sources: [] })), execute: vi.fn() };
  const composeOptions = { ownerId: owner.ownerId, editor, base, records, preparedEditorMedia: worker, editorCancellation: worker };
  const authenticate = (req: Request) => req.headers.get("x-fixture-user") === "owner" ? owner
    : req.headers.get("x-fixture-user") === "foreign" ? { ...owner, ownerId: "other" }
    : req.headers.get("x-fixture-user") === "read-only" ? { ...owner, scopes: ["read"] } : null;
  const handlersFor = (port: typeof dispatcher | undefined = dispatch ? dispatcher : undefined) => {
    const composed = composeMarketingParity({ ...composeOptions, editorDispatch: port });
    return { ...createMarketingHttpHandlers({ ...composed, authenticate, originAllowed: isSameOriginLoopbackMutation }),
      ...createMarketingResourceHandlers({ service: composed.resources, authenticate }) };
  };
  const handlers = handlersFor();
  const snapshot = await editor.load(owner, "project");
  const disk = async () => (await store.read())!.clipProjects[0].marketingEditor!;
  const assertNoSideEffects = async () => {
    expect(await Promise.all(originalFiles.map((file) => readFile(file, "utf8")))).toEqual(before);
    expect(base.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect((await readdir(root)).sort()).toEqual(["capital-command.json", "clips", "provider-records.json", "publish-queue.json", "snapshots", "threads-queue.json"]);
  };
  return { binding, editor, worker, dispatcher, dispatchOnce, handlers, handlersFor, composeOptions,
    records, store, snapshot, disk, document, jobs, assertNoSideEffects, createEditorExportDispatcher, composeMarketingParity, MarketingEditor };
}

describe("one-shot original editor dispatcher", () => {
  it("awaits one public intent/claim/independent outcome and preserves the immutable request receipt", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target);
    const response = await f.handlers.operations(httpCommand(cmd)); expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ replayed: false, receipt: { commandId: cmd.commandId, requestId: cmd.commandId, state: "pending_dispatch" }, snapshot: { export: { state: "prepared" } } });
    const state = await f.disk(); expect(state.exports).toHaveLength(1); expect(state.exports[0].state).toBe("prepared");
    expect(state.receipts.map((row) => row.result.operation)).toEqual(["request_editor_export", "claim_editor_export", "record_editor_export_outcome"]);
    expect(state.receipts[0].result).toEqual(result.receipt);
    expect(new Set(state.receipts.map((row) => row.result.commandId)).size).toBe(3);
    expect(state.receipts.every((row) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.result.commandId))).toBe(true);
    expect(f.worker.prepare).toHaveBeenCalledExactlyOnceWith("project", cmd.commandId, state.exports[0].attemptId);
    expect(f.worker.readPreparation).toHaveBeenCalledTimes(1); expect(f.dispatchOnce).toHaveBeenCalledTimes(1);
    await f.assertNoSideEffects();
  });

  it("prepares at most once across simultaneous public requests, explicit dispatch and reconstruction", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target);
    const results = await Promise.all([f.handlers.operations(httpCommand(cmd)), f.handlers.operations(httpCommand(cmd))]);
    expect(results.every((response) => response.status === 200)).toBe(true);
    const [first, second] = await Promise.all(results.map((response) => response.json()));
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]); expect(first.receipt).toEqual(second.receipt);
    const reconstructed = f.createEditorExportDispatcher({ binding: f.binding, editor: f.editor, worker: f.worker });
    await Promise.all([f.dispatcher.dispatchOnce({ command: cmd, receipt: first.receipt }), reconstructed.dispatchOnce({ command: cmd, receipt: first.receipt })]);
    const replay = await f.handlersFor(reconstructed).operations(httpCommand(cmd)); expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true); expect(f.worker.prepare).toHaveBeenCalledTimes(1);
    const changed = await f.handlers.operations(httpCommand({ ...cmd, target: { ...cmd.target, revision: 1 } })); expect(changed.status).toBe(409);
    expect((await f.disk()).receipts).toHaveLength(3); await f.assertNoSideEffects();
  });

  it("serializes concurrent dispatcher instances at the locked claim, including before prepare settles", async () => {
    const f = await fixture(false); const cmd = exportCommand(f.snapshot.target);
    const intent = await f.editor.requestExport(owner, cmd); const gate = deferred(), entered = deferred();
    f.worker.prepare.mockImplementationOnce(async () => { entered.release(); await gate.promise; });
    const second = f.createEditorExportDispatcher({ binding: f.binding, editor: f.editor, worker: f.worker });
    const a = f.dispatcher.dispatchOnce({ command: cmd, receipt: intent.receipt }); await entered.promise;
    await second.dispatchOnce({ command: cmd, receipt: intent.receipt });
    expect(f.worker.prepare).toHaveBeenCalledTimes(1); gate.release(); await a;
    expect((await f.disk()).receipts).toHaveLength(3);
  });

  it("keeps default/no-dispatch pending and never resumes it on read, replay or reconstruction", async () => {
    const f = await fixture(false); const cmd = exportCommand(f.snapshot.target);
    expect((await f.handlers.operations(httpCommand(cmd))).status).toBe(200);
    const state = await f.disk(); expect(state.exports[0].state).toBe("pending_dispatch");
    const current = f.handlersFor(f.createEditorExportDispatcher({ binding: f.binding, editor: f.editor, worker: f.worker }));
    await current.workspace(httpRequest()); await current.editor(httpRequest(), "project");
    expect((await current.operations(httpCommand(cmd))).status).toBe(200);
    expect((await f.disk()).exports).toEqual(state.exports); expect(f.worker.prepare).not.toHaveBeenCalled(); expect(f.dispatchOnce).not.toHaveBeenCalled();
  });

  it("leaves a claimed interrupted attempt untouched on public replay/reconstruction, even in a prior epoch", async () => {
    const f = await fixture(false); const cmd = exportCommand(f.snapshot.target);
    const intent = await f.editor.requestExport(owner, cmd);
    // Lose the response AFTER the real durable deterministic claim, before preparation.
    const claim = f.editor.claimExport.bind(f.editor);
    const lost = vi.spyOn(f.editor, "claimExport").mockImplementationOnce(async (...args) => { await claim(...args); throw new Error("lost claim response"); });
    await expect(f.dispatcher.dispatchOnce({ command: cmd, receipt: intent.receipt })).rejects.toHaveProperty("name", "EditorExportDispatchUncertain"); lost.mockRestore();
    const before = await f.disk(); expect(before.exports[0].state).toBe("claimed");
    const data = JSON.parse(await readFile(f.document, "utf8")); data.clipProjects[0].marketingEditor.exports[0].workerEpoch = randomUUID();
    await writeFile(f.document, JSON.stringify(data));
    const restarted = f.createEditorExportDispatcher({ binding: f.binding, editor: f.editor, worker: f.worker });
    await restarted.dispatchOnce({ command: cmd, receipt: intent.receipt });
    const replay = await f.handlersFor(restarted).operations(httpCommand(cmd)); expect((await replay.json()).replayed).toBe(true);
    expect(f.worker.prepare).not.toHaveBeenCalled(); expect((await f.disk()).receipts).toHaveLength(2);
  });

  it("fails closed on foreign owner, same-shaped worker, editor, source binding, media and cancellation ports", async () => {
    const f = await fixture();
    expect(() => f.createEditorExportDispatcher({ binding: f.binding, editor: f.editor, worker: { ...f.worker } })).toThrow("exact original");
    for (const binding of [{ ...f.binding, ownerId: "other" }, { ...f.binding, records: [{ ...f.binding.records[0], sourceFile: "different.mp4" }] },
      { ...f.binding, records: [...f.binding.records, { ...f.binding.records[0], projectId: "unlisted" }] }]) {
      expect(() => f.createEditorExportDispatcher({ binding, editor: f.editor, worker: f.worker })).toThrow("exact original");
    }
    for (const override of [{ ownerId: "other" }, { editor: new f.MarketingEditor({ binding: f.binding, worker: f.worker }) },
      { preparedEditorMedia: undefined }, { preparedEditorMedia: { ...f.worker } }, { editorCancellation: { ...f.worker } }]) {
      expect(() => f.composeMarketingParity({ ...f.composeOptions, editorDispatch: f.dispatcher, ...override })).toThrow("original owner");
    }
    expect(() => f.composeMarketingParity({ ...f.composeOptions, editorDispatch: f.dispatcher, editorCancellation: undefined })).not.toThrow();
    expect(f.worker.prepare).not.toHaveBeenCalled();
  });

  it("rejects anonymous/foreign/read-only/unlisted/created children and public worker or proof injection", async () => {
    const f = await fixture(true, true); const cmd = exportCommand(f.snapshot.target);
    for (const [user, status] of [["anonymous", 401], ["foreign", 403], ["read-only", 403]] as const) {
      expect((await f.handlers.operations(httpCommand(cmd, user))).status).toBe(status);
    }
    expect((await f.handlers.operations(httpCommand({ ...cmd, target: { ...cmd.target, projectId: "unlisted" } }))).status).toBe(403);
    for (const extra of [{ outcome: "prepared" }, { workerEpoch: randomUUID() }, { file: "C:\\private\\forged.mp4" }, { proof: {} }, { attemptId: randomUUID() }]) {
      expect((await f.handlers.operations(httpCommand({ ...cmd, ...extra }))).status).toBe(400);
    }
    for (const operation of ["claim_editor_export", "record_editor_export_outcome", "settle_editor_export_cancellation"]) {
      expect((await f.handlers.operations(httpCommand({ ...cmd, operation }))).status).toBe(400);
    }
    const context = await f.editor.getCreationContext(owner, "project");
    const created = await f.handlers.operations(httpCommand({ ...context, operation: "create_editor_project_from_source", commandId: randomUUID() }));
    expect(created.status).toBe(200); const child = await created.json();
    expect((await f.handlers.operations(httpCommand(exportCommand(child.childTarget)))).status).toBe(403);
    expect(f.dispatchOnce).not.toHaveBeenCalled(); expect(f.worker.prepare).not.toHaveBeenCalled(); await f.assertNoSideEffects();
  });

  it("does not dispatch reads, media, saves, creates, cancels, reconciliation, deletion or source preparation", async () => {
    const f = await fixture(true, true);
    await f.handlers.workspace(httpRequest()); await f.handlers.records(httpRequest()); await f.handlers.editor(httpRequest(), "project");
    const snapshot = await (await f.handlers.editor(httpRequest(), "project")).json();
    for (const method of ["GET", "HEAD"]) {
      const media = await f.handlers.media(httpRequest("owner", method, { Range: "bytes=0-2" }), snapshot.media.source.mediaId);
      await media.arrayBuffer();
    }
    const saved = await f.handlers.operations(httpCommand({ operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target, project: snapshot.project }));
    expect(saved.status).toBe(200); const target = (await saved.json()).snapshot.target;
    const context = await f.editor.getCreationContext(owner, "project");
    expect((await f.handlers.operations(httpCommand({ ...context, operation: "create_editor_project_from_source", commandId: randomUUID() }))).status).toBe(200);
    const cmd = exportCommand(target); await f.editor.requestExport(owner, cmd);
    expect((await f.handlers.operations(httpCommand({ operation: "cancel_editor_export", commandId: randomUUID(), target, requestId: cmd.commandId }))).status).toBe(200);
    expect((await f.handlers.operations(httpCommand({ operation: "reconcile_editor_export", commandId: randomUUID(), target, requestId: cmd.commandId }))).status).toBe(200);
    expect((await f.handlers.operations(httpCommand({ operation: "prepare_source", commandId: randomUUID(), runId: `site-${randomUUID()}`, sourceId: "source", expectedRevision: 1 }))).status).toBe(503);
    expect((await f.handlers.operations(httpCommand({ operation: "delete_editor_project", commandId: randomUUID(), target }))).status).toBe(200);
    expect(f.dispatchOnce).not.toHaveBeenCalled(); expect(f.worker.prepare).not.toHaveBeenCalled(); await f.assertNoSideEffects();
  });

  it("does not claim or prepare when durable intent persistence fails", async () => {
    const f = await fixture(); f.store.mutate.mockRejectedValueOnce(new Error("synthetic intent disk failure"));
    const claim = vi.spyOn(f.editor, "claimExport");
    const response = await f.handlers.operations(httpCommand(exportCommand(f.snapshot.target)));
    expect(response.status).toBe(500); expect((await response.json()).error.outcome).toBe("uncertain");
    expect(claim).not.toHaveBeenCalled(); expect(f.dispatchOnce).not.toHaveBeenCalled(); expect(f.worker.prepare).not.toHaveBeenCalled();
    expect((await f.store.read())!.clipProjects[0].marketingEditor).toBeUndefined();
  });

  it("does not prepare or fabricate failure when the claim cannot be confirmed", async () => {
    const f = await fixture(); vi.spyOn(f.editor, "claimExport").mockRejectedValueOnce(new Error("claim write unknown"));
    const response = await f.handlers.operations(httpCommand(exportCommand(f.snapshot.target)));
    expect(response.status).toBe(503); expect((await response.json()).error.outcome).toBe("uncertain");
    expect(f.worker.prepare).not.toHaveBeenCalled(); expect((await f.disk()).exports[0].state).toBe("pending_dispatch");
    expect((await f.disk()).receipts).toHaveLength(1);
  });

  it("rejects a forged, uncommitted or changed receipt before any claim", async () => {
    const f = await fixture(false); const cmd = exportCommand(f.snapshot.target), claim = vi.spyOn(f.editor, "claimExport");
    const receipt = { ...f.snapshot.target, commandId: cmd.commandId, requestId: cmd.commandId, operation: cmd.operation, state: "pending_dispatch" as const,
      reviewInvalidated: true as const, publicationAuthorized: false as const };
    const { projectId: _project, jobId: _job, clipId: _clip, ...hint } = receipt;
    await expect(f.dispatcher.dispatchOnce({ command: cmd, receipt: hint })).rejects.toThrow("requires reconciliation");
    const original = await f.editor.requestExport(owner, cmd);
    await expect(f.dispatcher.dispatchOnce({ command: cmd, receipt: { ...original.receipt, requestId: randomUUID() } })).rejects.toThrow("requires reconciliation");
    expect(claim).not.toHaveBeenCalled(); expect(f.worker.prepare).not.toHaveBeenCalled();
  });

  it("records only exact uncertainty after prepare rejects and never retries the retained UUID", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target);
    f.worker.prepare.mockRejectedValueOnce(new Error("private render path"));
    const response = await f.handlers.operations(httpCommand(cmd)); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.error.outcome).toBe("uncertain"); expect(JSON.stringify(body)).not.toContain("private render path");
    const state = await f.disk(); expect(state.exports[0].state).toBe("uncertain");
    expect(state.receipts.at(-1)!.result).toMatchObject({ operation: "record_editor_export_outcome", state: "uncertain", attemptId: state.exports[0].attemptId });
    expect(state.receipts.some((row) => row.result.state === "failed_before_dispatch")).toBe(false);
    expect((await f.handlers.operations(httpCommand(cmd))).status).toBe(200); expect(f.worker.prepare).toHaveBeenCalledTimes(1);
  });

  it("retains the claim when both prepared and uncertain outcome writes are unconfirmed", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target);
    vi.spyOn(f.editor, "recordExportOutcome").mockRejectedValue(new Error("outcome store unavailable"));
    const response = await f.handlers.operations(httpCommand(cmd)); expect((await response.json()).error.outcome).toBe("uncertain");
    const state = await f.disk(); expect(state.exports[0].state).toBe("claimed"); expect(state.receipts).toHaveLength(2);
    await f.handlers.operations(httpCommand(cmd)); expect(f.worker.prepare).toHaveBeenCalledTimes(1);
  });

  it("uses a distinct exact uncertainty command if the prepared outcome was not committed", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target);
    const record = vi.spyOn(f.editor, "recordExportOutcome").mockRejectedValueOnce(new Error("prepared outcome not confirmed"));
    const response = await f.handlers.operations(httpCommand(cmd)); expect((await response.json()).error.outcome).toBe("uncertain");
    expect(record.mock.calls.map((call) => call[1].outcome)).toEqual(["prepared", "uncertain"]);
    expect(record.mock.calls[0][1].commandId).not.toBe(record.mock.calls[1][1].commandId);
    expect(record.mock.calls[0][1].attemptId).toBe(record.mock.calls[1][1].attemptId);
    expect((await f.disk()).exports[0].state).toBe("uncertain");
  });

  it("requires the newly committed claim's complete state/attempt receipt before preparing", async () => {
    const f = await fixture(); const claim = f.editor.claimExport.bind(f.editor);
    vi.spyOn(f.editor, "claimExport").mockImplementationOnce(async (...args) => {
      const result = await claim(...args); return { ...result, receipt: { ...result.receipt, attemptId: undefined } };
    });
    const response = await f.handlers.operations(httpCommand(exportCommand(f.snapshot.target)));
    expect((await response.json()).error.outcome).toBe("uncertain"); expect(f.worker.prepare).not.toHaveBeenCalled();
    expect((await f.disk()).exports[0].state).toBe("claimed");
  });

  it("does not downgrade a prepared outcome when its response is lost", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target);
    const outcome = f.editor.recordExportOutcome.bind(f.editor);
    vi.spyOn(f.editor, "recordExportOutcome").mockImplementation(async (...args) => {
      const result = await outcome(...args); if (args[1].outcome === "prepared") throw new Error("prepared response lost"); return result;
    });
    const response = await f.handlers.operations(httpCommand(cmd)); expect((await response.json()).error.outcome).toBe("uncertain");
    expect((await f.disk()).exports[0].state).toBe("prepared"); expect((await f.disk()).receipts).toHaveLength(3);
    const replay = await (await f.handlers.operations(httpCommand(cmd))).json();
    expect(replay).toMatchObject({ replayed: true, receipt: { state: "pending_dispatch" }, snapshot: { export: { state: "prepared" } } });
    expect(f.worker.prepare).toHaveBeenCalledTimes(1);
  });

  it("retains the original UUID when post-dispatch projection fails", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target); let calls = 0;
    const mediaId = f.records.mediaId.bind(f.records);
    const read = vi.spyOn(f.records, "mediaId").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("projection lost"); return mediaId(...args);
    });
    const response = await f.handlers.operations(httpCommand(cmd)); expect((await response.json()).error.outcome).toBe("uncertain"); read.mockRestore();
    const state = await f.disk(); expect(state.receipts[0].result.commandId).toBe(cmd.commandId); expect(state.exports[0].state).toBe("prepared");
    const replay = await (await f.handlers.operations(httpCommand(cmd))).json(); expect(replay.replayed).toBe(true); expect(replay.receipt.commandId).toBe(cmd.commandId);
    expect(f.worker.prepare).toHaveBeenCalledTimes(1);
  });

  it("lets cancellation win before claim with zero prepare", async () => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target); const dispatch = f.dispatcher.dispatchOnce.bind(f.dispatcher);
    f.dispatchOnce.mockImplementationOnce(async (input) => {
      await f.editor.cancelExport(owner, { operation: "cancel_editor_export", commandId: randomUUID(), target: cmd.target, requestId: cmd.commandId });
      await dispatch(input);
    });
    const response = await f.handlers.operations(httpCommand(cmd)); expect((await response.json()).error.outcome).toBe("uncertain");
    expect((await f.disk()).exports[0].state).toBe("canceled"); expect(f.worker.prepare).not.toHaveBeenCalled();
  });

  it.each(["cancel", "cancel_unconfirmed", "edit", "delete"] as const)("fences late controlled preparation after a public %s", async (change) => {
    const f = await fixture(); const cmd = exportCommand(f.snapshot.target), gate = deferred(), entered = deferred();
    if (change === "cancel_unconfirmed") f.worker.abortExact.mockRejectedValueOnce(new Error("stop not confirmed"));
    f.worker.prepare.mockImplementationOnce(async () => { entered.release(); await gate.promise; return { forgedLateProof: true }; });
    const running = f.handlers.operations(httpCommand(cmd)); await entered.promise;
    try {
      const intent = (await f.disk()).exports[0];
      const changeCommand = change.startsWith("cancel") ? { operation: "cancel_editor_export", commandId: randomUUID(), target: cmd.target, requestId: cmd.commandId, attemptId: intent.attemptId }
        : change === "edit" ? { operation: "save_editor_project", commandId: randomUUID(), target: cmd.target, project: { ...f.snapshot.project, title: "New edit" } }
        : { operation: "delete_editor_project", commandId: randomUUID(), target: cmd.target };
      expect((await f.handlers.operations(httpCommand(changeCommand))).status).toBe(200);
      if (change.startsWith("cancel")) expect(f.worker.abortExact).toHaveBeenCalledExactlyOnceWith("project", cmd.commandId, intent.attemptId, changeCommand.commandId);
    } finally { gate.release(); }
    const response = await running; expect((await response.json()).error.outcome).toBe("uncertain");
    expect((await f.disk()).exports[0].state).toBe(change === "cancel" ? "uncertain" : change === "cancel_unconfirmed" ? "cancel_requested" : "stale");
    expect((await f.disk()).receipts.some((row) => row.result.state === "prepared")).toBe(false); expect(f.worker.prepare).toHaveBeenCalledTimes(1);
  });
});
