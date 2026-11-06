import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { makeClipProject } from "@/lib/clipping/editor";
import { dataPath } from "@/lib/paths";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createEditorPreparationWorker, editorPreparationSpec } from "./editor-renderer";
import { preparationSpecDigest, prepareClipExport } from "@/lib/clipping/export";
import { editorProjectDigest, editorRenderSignature, preserveManagedEditorProjects } from "./editor-state";
import { MarketingEditor } from "./editor";
import { appDataSchema } from "@/lib/storage/schemas";
import { emptyData } from "@/lib/mockData/seed";
import type { ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";
import { CancellationTestScope } from "./test-support/cancellation-test-scope";

const gates = vi.hoisted(() => ({
  mode: "" as "" | "render" | "probe" | "source" | "cleanup" | "active-render", entered: false,
  release: undefined as (() => void) | undefined,
  scope: undefined as CancellationTestScope | undefined,
  calls: [] as { args: string[]; signal?: AbortSignal; closed: boolean }[],
  children: [] as { pid: number; closed: boolean }[],
  attach: vi.fn(), enqueue: vi.fn()
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args);
    if ((args[1] as string[] | undefined)?.some((arg) => /prepared\.mp4$/.test(arg)) && child.pid) {
      const observed = { pid: child.pid, closed: false }; gates.children.push(observed);
      child.once("close", () => { observed.closed = true; });
    }
    return child;
  } };
});
vi.mock("@/lib/clipping/jobs", async () => {
  const { dataPath } = await import("@/lib/paths");
  return { outputDir: (id: string) => dataPath("clips", "outputs", id), workDir: (id: string) => dataPath("clips", "uploads", id),
    attachEditedClipRender: gates.attach };
});
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: gates.enqueue }));
vi.mock("@/lib/clipping/ffmpeg", async (original) => {
  const actual = await original<typeof import("@/lib/clipping/ffmpeg")>();
  return { ...actual, runFfmpeg: vi.fn(async (...args: Parameters<typeof actual.runFfmpeg>) => {
    const call = { args: args[0], signal: args[1]?.signal, closed: false }; gates.calls.push(call);
    const prepared = args[0].some((arg) => /prepared\.mp4$/.test(arg));
    const probe = args[0].at(-2) === "-i";
    if (gates.mode === "active-render" && prepared && !probe) {
      const input = args[0].indexOf("-i"); args[0].splice(input, 0, "-re"); args[0].unshift("-stats_period", "0.05");
      const onLine = args[1]?.onLine;
      args[1] = { ...args[1], onLine: (line) => { onLine?.(line);
        if (/frame=\s*[1-9]/.test(line)) gates.entered = true;
      } };
    }
    let result: Awaited<ReturnType<typeof actual.runFfmpeg>>;
    try { result = await actual.runFfmpeg(...args); } finally { call.closed = true; }
    if ((gates.mode === "render" && prepared && !probe) || (gates.mode === "probe" && prepared && probe)
      || (gates.mode === "source" && !prepared && probe && args[0].includes("-protocol_whitelist"))) {
      gates.mode = ""; gates.entered = true;
      const gate = gates.scope!.gate(); gates.release = gate.release; await gate.promise;
    }
    return result;
  }) };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(async (...args: Parameters<typeof actual.rm>) => {
    await actual.rm(...args);
    if (gates.mode === "cleanup" && String(args[0]).endsWith(`${path.sep}scratch`)) {
      gates.mode = ""; gates.entered = true;
      const gate = gates.scope!.gate(); gates.release = gate.release; await gate.promise;
    }
  }) };
});
afterEach(async () => {
  try { await gates.scope?.close(); }
  finally {
    gates.scope = undefined; gates.mode = ""; gates.entered = false; gates.release = undefined;
    gates.calls = []; gates.children = []; vi.clearAllMocks(); vi.unstubAllEnvs();
  }
});
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function scoped<Args extends unknown[]>(body: (scope: CancellationTestScope, ...args: Args) => Promise<void>) {
  return (...args: Args) => {
    if (gates.scope) throw new Error("The previous cancellation test scope has not settled.");
    const scope = new CancellationTestScope(); gates.scope = scope;
    return scope.runBody(() => body(scope, ...args));
  };
}

function ownedWorker(scope: CancellationTestScope, options: Parameters<typeof createEditorPreparationWorker>[0]) {
  scope.assertOpen();
  const worker = createEditorPreparationWorker(options);
  return { ...worker,
    prepare: (...[projectId, requestId, attemptId, renderOptions = {}]: Parameters<typeof worker.prepare>) => {
      const controller = scope.controller(renderOptions.signal);
      return scope.start(() => worker.prepare(projectId, requestId, attemptId, { ...renderOptions, signal: controller.signal }));
    },
    inspectAttempt: (...args: Parameters<typeof worker.inspectAttempt>) => scope.start(() => worker.inspectAttempt(...args)),
    abortExact: (...args: Parameters<typeof worker.abortExact>) => scope.start(() => worker.abortExact(...args)),
    readCancellationSettlement: (...args: Parameters<typeof worker.readCancellationSettlement>) => scope.start(() => worker.readCancellationSettlement(...args)),
    readPreparation: (...args: Parameters<typeof worker.readPreparation>) => scope.start(() => worker.readPreparation(...args)),
    readArtifact: (...args: Parameters<typeof worker.readArtifact>) => scope.start(() => worker.readArtifact(...args)),
    readCurrentArtifact: (...args: Parameters<typeof worker.readCurrentArtifact>) => scope.start(() => worker.readCurrentArtifact(...args))
  };
}

function waitUntil(scope: CancellationTestScope, predicate: () => boolean, options?: Parameters<typeof vi.waitUntil>[1]) {
  return scope.start(() => vi.waitUntil(() => { scope.assertOpen(); return predicate(); }, options));
}

function fixture(scope: CancellationTestScope, sourceFile = "source.mp4", duration = 1.2) {
  const controller = scope.controller();
  return scope.start(() => makeFixture(scope, controller.signal, sourceFile, duration));
}

async function makeFixture(scope: CancellationTestScope, signal: AbortSignal, sourceFile: string, duration: number) {
  vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  const jobId = `cancel-${randomUUID()}`;
  const project = makeClipProject({ jobId, name: "Synthetic cancellation", sourceFile, sourceUrl: "",
    clipStart: 10, clipEnd: 10 + duration, sourceFrame: { width: 160, height: 90, fps: 10 } });
  project.compositionMode = "fit"; project.captionsVisible = false;
  project.exportSettings = { ...project.exportSettings, width: 160, height: 90, fps: 10 };
  const source = dataPath("clips", "outputs", jobId, sourceFile);
  await mkdir(path.dirname(source), { recursive: true });
  await runFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=navy:s=160x90:r=10:d=${duration}`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { signal });
  scope.assertOpen();
  const job = { id: jobId, clips: [{ id: "clip", start: 10, end: 10 + duration, file: sourceFile }] } as ClipJob;
  const jobsFile = dataPath("clips", "jobs.json"); await writeFile(jobsFile, JSON.stringify([job]));
  const jobsBefore = await readFile(jobsFile, "utf8");
  const record = { projectId: project.id, jobId, clipId: "clip", sourceFile, sourceSha256: sha(await readFile(source)) };
  const digest = editorProjectDigest(project), signature = editorRenderSignature(project);
  const intent = { requestId: randomUUID(), attemptId: randomUUID(), workerEpoch: "", revision: 1,
    digest, renderSignature: signature, state: "claimed" as "claimed" | "cancel_requested" | "prepared" | "stale", cancellation: undefined as { commandId: string; requestedAt: string } | undefined,
    exportId: undefined as string | undefined, artifactSha256: undefined as string | undefined };
  const managed = { ...project, marketingEditor: { ownerId: "owner", jobId, clipId: "clip", revision: 1,
    digest, renderSignature: signature, exports: [intent], receipts: [] } };
  const store = { read: vi.fn(async () => appDataSchema.parse({ ...emptyData, clipProjects: [managed] })), readJob: vi.fn(async () => structuredClone(job)),
    mutate: async (_id: string, update: (project: ClipProject) => ClipProject) => {
      Object.assign(managed, update(structuredClone(managed))); return structuredClone(managed);
    } };
  const options = { binding: { ownerId: "owner", records: [record] }, store };
  scope.assertOpen();
  const worker = ownedWorker(scope, options); intent.workerEpoch = worker.getWorkerEpoch();
  const cancel = () => { intent.state = "cancel_requested"; intent.cancellation = { commandId: randomUUID(), requestedAt: new Date().toISOString() };
    return intent.cancellation.commandId; };
  const assertNoSideEffects = async () => {
    expect(gates.attach).not.toHaveBeenCalled(); expect(gates.enqueue).not.toHaveBeenCalled();
    expect(await readFile(jobsFile, "utf8")).toBe(jobsBefore);
  };
  return { project: managed, intent, worker, options, source, record, cancel, assertNoSideEffects };
}

it.each(["source", "render", "probe", "cleanup"] as const)("waits for the real %s operation and cleanup before cancellation proof", scoped(async (scope, phase: "source" | "render" | "probe" | "cleanup") => {
  const f = await fixture(scope); gates.calls = []; gates.mode = phase;
  const running = f.worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId);
  const rejected = scope.assertion(expect(running).rejects.toMatchObject({ name: "RenderCanceledError" }));
  await waitUntil(scope, () => gates.entered, { timeout: 10_000 });
  expect((await f.worker.inspectAttempt(f.project, f.intent)).status).toBe("active");
  await scope.assertion(expect(f.worker.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, randomUUID())).rejects.toThrow("persisted"));
  const cancelId = f.cancel();
  const stopping = f.worker.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId);
  await waitUntil(scope, () => gates.calls.some((call) => call.signal?.aborted), { timeout: 1000 });
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toBeNull();
  gates.release!(); await stopping; await rejected;
  const proof = await f.worker.readCancellationSettlement(f.project, f.intent);
  expect(proof).toMatchObject({ settled: true, requestId: f.intent.requestId, attemptId: f.intent.attemptId, cancelCommandId: cancelId });
  proof!.assertCurrent(); expect(await f.worker.readPreparation(f.project, f.intent)).toBeNull();
  const calls = gates.calls.filter((call) => call.args.includes("-protocol_whitelist"));
  expect(calls.every((call) => call.signal && call.closed)).toBe(true);
  if (phase === "source") expect(calls.some((call) => call.args.some((arg) => /prepared\.mp4$/.test(arg)))).toBe(false);
  await f.assertNoSideEffects();
}), 20_000);

it("kills only its actual in-flight synthetic FFmpeg child and observes close before successful settlement", scoped(async (scope) => {
  const f = await fixture(scope, "source.mp4", 10); gates.calls = []; gates.mode = "active-render";
  const running = f.worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId);
  const outcome = running.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
  await waitUntil(scope, () => gates.entered, { timeout: 10_000, interval: 5 });
  const child = gates.children.find((candidate) => !candidate.closed)!;
  expect(child).toBeDefined(); expect(() => process.kill(child.pid, 0)).not.toThrow();
  const render = gates.calls.find((call) => call.args.at(-1)?.endsWith("prepared.mp4"))!;
  expect(render.closed).toBe(false);
  const cancelId = f.cancel(); await f.worker.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId);
  expect((await outcome).error).toMatchObject({ name: "RenderCanceledError" });
  expect(child.closed).toBe(true); expect(render.closed).toBe(true);
  expect(() => process.kill(child.pid, 0)).toThrow();
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toMatchObject({ settled: true, cancelCommandId: cancelId });
  await scope.assertion(expect(stat(render.args.at(-1)!)).rejects.toMatchObject({ code: "ENOENT" }));
  await mkdir(path.join(process.cwd(), ".test-artifacts", "cancellation"), { recursive: true });
  await writeFile(path.join(process.cwd(), ".test-artifacts", "cancellation", "actual-ffmpeg-abort.json"), JSON.stringify({
    syntheticOnly: true, observedPid: child.pid, observedClose: child.closed, processAbsent: true, outputRemoved: true,
    workerEpoch: f.intent.workerEpoch, cancelCommandId: cancelId, qualification: "Exact newly spawned synthetic child, real SIGKILL and close; no OS crash inferred."
  }, null, 2));
  await f.assertNoSideEffects();
}), 20_000);

it.each(["adapter", "original"] as const)("reserves before its first read and stops an exact retained fence after %s deletion with unavailable media", scoped(async (scope, kind: "adapter" | "original") => {
  const f = await fixture(scope); const gate = scope.gate(); let entered = false;
  f.options.store.read.mockImplementationOnce(async () => { entered = true; await gate.promise; return appDataSchema.parse({ ...emptyData, clipProjects: [f.project] }); });
  const running = f.worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId);
  const rejected = scope.assertion(expect(running).rejects.toMatchObject({ name: "RenderCanceledError" }));
  await waitUntil(scope, () => entered);
  const owner = { ownerId: "owner", scopes: ["write"] as const };
  const target = { projectId: f.project.id, jobId: f.project.jobId, clipId: "clip", revision: 1,
    digest: f.intent.digest, renderSignature: f.intent.renderSignature };
  const editor = new MarketingEditor({ binding: f.options.binding, store: f.options.store, worker: f.worker });
  const cancelId = randomUUID();
  await scope.start(() => editor.cancelExport({ ...owner, scopes: [...owner.scopes] }, { operation: "cancel_editor_export", commandId: cancelId, target,
    requestId: f.intent.requestId, attemptId: f.intent.attemptId }));
  if (kind === "adapter") await scope.start(() => editor.deleteProject({ ...owner, scopes: [...owner.scopes] }, { operation: "delete_editor_project", commandId: randomUUID(), target }));
  else {
    const previous = appDataSchema.parse({ ...emptyData, clipProjects: [f.project] });
    const deleted = preserveManagedEditorProjects({ ...previous, clipProjects: [] }, previous).clipProjects[0];
    Object.assign(f.project, deleted);
  }
  const retained = f.project.marketingEditor.exports[0];
  expect(retained.state).toBe("stale"); expect(retained.cancellation?.commandId).toBe(cancelId);
  await rm(f.source);
  const reconstructed = ownedWorker(scope, f.options);
  expect(reconstructed.getWorkerEpoch()).toBe(f.worker.getWorkerEpoch());
  const stopping = reconstructed.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId);
  await Promise.resolve(); gate.release(); await stopping; await rejected;
  expect(await reconstructed.readCancellationSettlement(f.project, retained)).toMatchObject({ settled: true, cancelCommandId: cancelId });
  await reconstructed.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId);
  const other = ownedWorker(scope, { ...f.options, binding: { ...f.options.binding, ownerId: "other-owner" } });
  await scope.assertion(expect(other.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId)).rejects.toThrow("ownership"));
  await f.assertNoSideEffects();
}));

it("rejects a final progress callback stop, then independently recovers a persisted prepared artifact after reconstruction", scoped(async (scope) => {
  const f = await fixture(scope, "café (take 1) + final.mp4"); const external = new AbortController();
  await scope.assertion(expect(f.worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId, { signal: external.signal,
    onProgress: (percent) => { if (percent === 100) external.abort(); } })).rejects.toMatchObject({ name: "RenderCanceledError" }));
  expect(await f.worker.readPreparation(f.project, f.intent)).toBeNull();
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toBeNull();
  const next = await fixture(scope, "café (take 1) + final.mp4");
  const proof = await next.worker.prepare(next.project.id, next.intent.requestId, next.intent.attemptId);
  next.intent.state = "prepared"; next.intent.exportId = proof.exportId; next.intent.artifactSha256 = proof.artifactSha256;
  const restarted = ownedWorker(scope, next.options);
  const recovered = await restarted.readCurrentArtifact(next.project.id, next.intent.requestId);
  expect(recovered.artifactSha256).toBe(sha(await readFile(recovered.file))); recovered.assertCurrent();
  expect((await readdir(path.dirname(recovered.file))).sort()).toEqual(["prepared.mp4"]);
  await next.assertNoSideEffects();
}), 20_000);

it("never runs a persisted prior-epoch claim and does not infer stop from missing controller evidence", scoped(async (scope) => {
  const f = await fixture(scope); f.intent.workerEpoch = randomUUID(); const cancelId = f.cancel();
  expect((await f.worker.inspectAttempt(f.project, f.intent)).status).toBe("prior_epoch");
  await f.worker.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId);
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toBeNull();
  await scope.assertion(expect(f.worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId)).rejects.toThrow("different owning process epoch"));
  await f.assertNoSideEffects();
}));

it("recovers fully verified persisted prepared output from a prior epoch without dispatching it", scoped(async (scope) => {
  const f = await fixture(scope); f.intent.workerEpoch = randomUUID();
  const spec = editorPreparationSpec(f.project);
  const trusted = { ...f.record, ownerId: "owner", requestId: f.intent.requestId, attemptId: f.intent.attemptId,
    workerEpoch: f.intent.workerEpoch, projectDigest: f.intent.digest, renderSignature: f.intent.renderSignature,
    specSha256: preparationSpecDigest(spec) };
  const controller = scope.controller();
  const proof = await scope.start(() => prepareClipExport(trusted, async () => ({ binding: trusted, spec }), { signal: controller.signal }));
  f.intent.state = "prepared"; f.intent.exportId = proof.exportId; f.intent.artifactSha256 = proof.artifactSha256;
  const reconstructed = ownedWorker(scope, f.options);
  gates.calls = [];
  const recovered = await reconstructed.readCurrentArtifact(f.project.id, f.intent.requestId);
  expect(recovered.artifactSha256).toBe(proof.artifactSha256); recovered.assertCurrent();
  expect(gates.calls.every((call) => call.args.at(-2) === "-i")).toBe(true);
  expect((await reconstructed.inspectAttempt(f.project, f.intent)).status).toBe("prior_epoch");
  await f.assertNoSideEffects();
}), 20_000);

it("never caches a proof when cancellation wins the worker's final current-intent read", scoped(async (scope) => {
  const f = await fixture(scope); const gate = scope.gate(); let hold = false; let entered = false;
  f.options.store.read.mockImplementation(async () => {
    if (hold) { hold = false; entered = true; await gate.promise; }
    return appDataSchema.parse({ ...emptyData, clipProjects: [f.project] });
  });
  const running = f.worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId, { onProgress: (percent) => { if (percent === 100) hold = true; } });
  const outcome = running.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
  await waitUntil(scope, () => entered, { timeout: 10_000 });
  const cancelId = f.cancel(); const stopping = f.worker.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId, cancelId);
  await Promise.resolve(); expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toBeNull();
  gate.release(); await stopping; expect((await outcome).value).toBeUndefined(); expect((await outcome).error).toBeInstanceOf(Error);
  expect(await f.worker.readPreparation(f.project, f.intent)).toBeNull();
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toMatchObject({ settled: true, cancelCommandId: cancelId });
  await f.assertNoSideEffects();
}), 20_000);
