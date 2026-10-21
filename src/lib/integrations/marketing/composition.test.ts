import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "./safety";

const owner: Principal = { ownerId: "synthetic-owner", scopes: ["read", "write", "review"] };
let root: string;
let dispose: (() => void) | undefined;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marketing-composition-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Synthetic composition forbids external network"); }));
});
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(realRender = false, imageFormat?: "png" | "jpeg" | "webp", controls?: {
  worker: import("./editor").EditorWorkerPorts; cancellation: import("./composition").EditorCancellationControl;
}, music?: { enabled: boolean; omitResolver?: boolean; unsupported?: boolean }, creation = false) {
  const { clipProjectSchema, appDataSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const project = clipProjectSchema.parse({ id: "project-a", name: "Synthetic corrected clip", jobId: "job-a", sourceFile: "master.mp4",
    sourceUrl: "https://example.invalid/private?token=fixture", baseDurationSec: 10, clipStart: 20, clipEnd: 30,
    trimStart: 0, trimEnd: 10, captions: [{ id: "caption-a", start: 1, end: 3, text: "Corrected caption", words: [], enabled: true }],
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" });
  if (realRender) {
    project.baseDurationSec = 1.6; project.clipEnd = 21.6; project.trimStart = 0.2; project.trimEnd = 1.2;
    project.baseWidth = 160; project.baseHeight = 90; project.compositionMode = "fit";
    project.captions = [{ id: "caption-a", start: 0.2, end: 1.2, text: "SYNTHETIC EDITOR", words: [], enabled: true }];
    project.exportSettings = { ...project.exportSettings, width: 160, height: 160, fps: 10, filename: "synthetic-proof" };
  }
  let musicBytes: Buffer | undefined;
  if (music?.enabled) {
    musicBytes = Buffer.alloc(44 + 8000 * 2 * 2);
    musicBytes.write("RIFF"); musicBytes.writeUInt32LE(musicBytes.length - 8, 4); musicBytes.write("WAVEfmt ", 8);
    musicBytes.writeUInt32LE(16, 16); musicBytes.writeUInt16LE(1, 20); musicBytes.writeUInt16LE(1, 22);
    musicBytes.writeUInt32LE(8000, 24); musicBytes.writeUInt32LE(16000, 28); musicBytes.writeUInt16LE(2, 32);
    musicBytes.writeUInt16LE(16, 34); musicBytes.write("data", 36); musicBytes.writeUInt32LE(musicBytes.length - 44, 40);
    for (let frame = 0; frame < 16000; frame++) musicBytes.writeInt16LE(Math.round(Math.sin(frame * Math.PI / 4) * 8192), 44 + frame * 2);
    project.audio.musicSrc = music.unsupported ? "data:audio/mpeg;base64,SUQz" : `data:audio/wav;base64,${musicBytes.toString("base64")}`;
    project.audio.musicName = "Synthetic PCM music";
  }
  let image: { bytes: Buffer; file: string } | undefined;
  if (imageFormat) {
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(32, 16); const context = canvas.getContext("2d");
    context.fillStyle = "#ff0000"; context.fillRect(0, 0, 32, 16);
    const bytes = canvas.toBuffer(`image/${imageFormat}` as "image/png");
    const fileName = `${createHash("sha1").update(bytes).digest("hex")}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`;
    image = { bytes, file: path.join(root, "overlay-images", fileName) };
    await mkdir(path.dirname(image.file), { recursive: true }); await writeFile(image.file, bytes);
    project.overlays = [{ id: "stored-image", kind: "image", src: `/api/clips/overlay-images/${fileName}`,
      x: 0.25, y: 0.5, scale: 1, rotation: 0, opacity: 1, z: 0, locked: false, start: 0.3, end: 0.9 }];
  }
  const document = path.join(root, "capital-command.json");
  const jobs = path.join(root, "clips", "jobs.json");
  const output = path.join(root, "clips", "outputs", "job-a");
  await mkdir(output, { recursive: true });
  await writeFile(document, JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project] })));
  await writeFile(jobs, JSON.stringify([{ id: "job-a", fileName: "Synthetic source", sourceUrl: "upload://synthetic", status: "queued", stage: "downloading", progress: 12,
    notices: [], createdAt: project.createdAt, clips: [{ id: "clip-a", title: "Synthetic clip", start: project.clipStart, end: project.clipEnd, file: "master.mp4",
      score: 50, breakdown: { hook: 50, pacing: 50, standalone: 50, intensity: 50 }, rationale: "Synthetic" }],
    sourceCaptions: [{ id: "cached", start: 21, end: 23, text: "Cached source", words: [], enabled: true }] }]));
  await writeFile(path.join(output, "master.mp4"), "0123456789");
  const { MarketingEditor, readOriginalEditorJob } = await import("./editor");
  const editorBinding = { ownerId: owner.ownerId, records: [{ projectId: project.id, jobId: project.jobId,
    clipId: "clip-a", sourceFile: project.sourceFile }] };
  const { readExistingAppData } = await import("@/lib/storage/store");
  const overlayAssets = imageFormat ? (await import("./editor-overlay-assets")).createStoredEditorOverlayResolver({
    binding: editorBinding, store: { read: readExistingAppData } }) : undefined;
  const musicAssets = music?.enabled && !music.omitResolver ? (await import("./editor-audio-assets")).createStoredEditorMusicResolver({
    binding: editorBinding, store: { read: readExistingAppData } }) : undefined;
  let worker: ReturnType<typeof import("./editor-renderer").createEditorPreparationWorker> | undefined;
  if (realRender) {
    const { runFfmpeg } = await import("@/lib/clipping/ffmpeg");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=10:d=1.6", "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=1.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(output, "master.mp4")]);
    const { createEditorPreparationWorker } = await import("./editor-renderer");
    worker = createEditorPreparationWorker({ binding: { ownerId: owner.ownerId, records: [{ projectId: project.id,
      jobId: project.jobId, clipId: "clip-a", sourceFile: project.sourceFile,
      sourceSha256: createHash("sha256").update(await readFile(path.join(output, "master.mp4"))).digest("hex") }] },
      store: { read: readExistingAppData, readJob: readOriginalEditorJob }, overlayAssets, musicAssets });
  }
  const { createExistingRecordReader } = await import("./records");
  const { composeMarketingParity } = await import("./composition");
  const { installMarketingRuntime, marketingRuntime } = await import("./runtime");
  const { isSameOriginLoopbackMutation } = await import("./auth");
  const base = { workspace: vi.fn(async () => ({ connection: { state: "connected", message: "Synthetic original ledger" }, jobs: [], sources: [] })), execute: vi.fn() };
  const records = createExistingRecordReader({ resolveScope: (id) => id === owner.ownerId ? {
    ownerId: id, sourceIds: [], runIds: [], clipJobIds: ["job-a"], queueIds: [], accountIds: {},
  } : null });
  let creationPolicy: import("./editor-types").EditorCreationPolicy | null = creation ? {
    id: "fixture-creation", version: "v1", ownerId: owner.ownerId, roots: [{ ...editorBinding.records[0],
      sourceSha256: createHash("sha256").update(await readFile(path.join(output, "master.mp4"))).digest("hex"), maxCreatedProjects: 3 }],
  } : null;
  const editor = new MarketingEditor({ worker: controls?.worker ?? worker, binding: editorBinding, overlayAssets, musicAssets,
    ...(creation ? { creationPolicy: () => creationPolicy } : {}) });
  const composed = composeMarketingParity({ ownerId: owner.ownerId, base, records, editor, preparedEditorMedia: worker,
    editorCancellation: controls?.cancellation ?? worker, overlayAssets, musicAssets });
  dispose = installMarketingRuntime({ ...composed, originAllowed: isSameOriginLoopbackMutation,
    authenticate: (req) => req.headers.get("x-fixture-user") === "owner" ? owner
      : req.headers.get("x-fixture-user") === "other" ? { ...owner, ownerId: "other-owner" }
      : req.headers.get("x-fixture-user") === "read-only" ? { ...owner, scopes: ["read"] } : null });
  return { project, document, jobs, base, records, editor, worker, image, overlayAssets, musicBytes, musicAssets,
    revokeCreation: () => { creationPolicy = null; }, handlers: marketingRuntime()! };
}
const request = (pathName = "workspace", user = "owner") => new Request(`http://127.0.0.1:3100/api/integrations/marketing/${pathName}`, { headers: { "x-fixture-user": user } });
const command = (body: unknown, user = "owner") => new Request("http://127.0.0.1:3100/api/integrations/marketing/operations", {
  method: "POST", headers: { "x-fixture-user": user, "Content-Type": "application/json", Origin: "http://127.0.0.1:3100" }, body: JSON.stringify(body),
});

describe("composed original records/editor/media HTTP boundary", () => {
  it("keeps creation dormant by default and requires exact owner read/write scope", async () => {
    const f = await fixture(); const before = await readFile(f.document, "utf8");
    const context = await f.handlers.editorCreation(request("editor/project-a/creation"), "project-a");
    expect(context.status).toBe(200); expect(await context.json()).toBeNull();
    expect(context.headers.get("cache-control")).toContain("no-store");
    for (const user of ["other", "read-only"]) {
      expect((await f.handlers.editorCreation(request("editor/project-a/creation", user), "project-a")).status).toBe(403);
    }
    expect((await f.handlers.editorCreation(request("editor/project-a/creation", "anonymous"), "project-a")).status).toBe(401);
    expect(await readFile(f.document, "utf8")).toBe(before); expect(f.base.execute).not.toHaveBeenCalled();
  });

  it("creates through the original HTTP/store flow without invalidating the real prepared root or publishing", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(true, "png", undefined, { enabled: true }, true);
    const jobsBefore = await readFile(f.jobs, "utf8");
    const initial = await (await f.handlers.editor(request(), "project-a")).json();
    const exported = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: initial.target }))).json();
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: initial.target, requestId: exported.receipt.requestId });
    await f.worker!.prepare(f.project.id, exported.receipt.requestId, claimed.attemptId);
    await f.editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome", commandId: randomUUID(), target: initial.target,
      requestId: exported.receipt.requestId, attemptId: claimed.attemptId, outcome: "prepared" });
    const prepared = await (await f.handlers.editor(request(), "project-a")).json();
    const before = JSON.parse(await readFile(f.document, "utf8"));
    const creationContext = await (await f.handlers.editorCreation(request(), "project-a")).json();
    const cmd = { ...creationContext, operation: "create_editor_project_from_source", commandId: randomUUID() };
    const response = await f.handlers.operations(command(cmd)); expect(response.status).toBe(200);
    const created = await response.json();
    expect(created.receipt).toMatchObject({ commandId: cmd.commandId, rootProjectId: "project-a", creationRevision: 1,
      revision: initial.target.revision, digest: initial.target.digest, reviewInvalidated: false, rootReviewPreserved: true, publicationAuthorized: false });
    expect(Object.keys(created.receipt).sort()).toEqual(["operation", "commandId", "rootProjectId", "createdProjectId", "revision", "digest", "renderSignature",
      "policyId", "policyVersion", "creationRevision", "reviewInvalidated", "rootReviewPreserved", "publicationAuthorized"].sort());
    expect(created.childTarget).toEqual(created.snapshot.target); expect(created.createdProjectId).toBe(created.snapshot.project.id);
    expect(created.snapshot.capabilities.requestExport).toBe(false);
    expect(JSON.stringify(created)).not.toMatch(/sourceSha256|grantDigest|payloadSha256|sourceDigest|captionDigest|captionState|data:audio|token=fixture/);
    const after = JSON.parse(await readFile(f.document, "utf8"));
    expect(after.clipProjects).toHaveLength(before.clipProjects.length + 1);
    const { clipProjects: _beforeProjects, ...beforeOther } = before, { clipProjects: _afterProjects, ...afterOther } = after;
    expect(afterOther).toEqual(beforeOther);
    const storedRoot = (data: { clipProjects: import("@/types/domain").ClipProject[] }) => data.clipProjects.find((row) => row.id === "project-a")!;
    expect(storedRoot(after).marketingEditor!.exports).toEqual(storedRoot(before).marketingEditor!.exports);
    const current = await (await f.handlers.editor(request(), "project-a")).json();
    expect(current.target).toEqual(prepared.target); expect(current.media.edited).toEqual(prepared.media.edited);
    expect((await f.handlers.media(new Request(request(), { method: "HEAD" }), prepared.media.edited.mediaId)).status).toBe(200);
    const committed = await readFile(f.document, "utf8");
    const replay = await (await f.handlers.operations(command(cmd))).json();
    expect(replay).toMatchObject({ receipt: created.receipt, replayed: true, createdProjectId: created.createdProjectId });
    expect(await readFile(f.document, "utf8")).toBe(committed);
    expect((await f.handlers.operations(command({ ...cmd, commandId: randomUUID() }))).status).toBe(409);
    expect((await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: created.childTarget }))).status).toBe(403);
    expect(await readFile(f.document, "utf8")).toBe(committed);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore); expect(f.base.execute).not.toHaveBeenCalled();
    expect(await readdir(root)).not.toContain("publish"); expect(fetch).not.toHaveBeenCalled();
  }, 120_000);

  it("retains a public creation receipt across projection loss and policy revocation without a duplicate child", async () => {
    const f = await fixture(false, undefined, undefined, undefined, true);
    const context = await (await f.handlers.editorCreation(request(), "project-a")).json();
    const cmd = { ...context, operation: "create_editor_project_from_source", commandId: randomUUID() };
    const media = vi.spyOn(f.records, "mediaId").mockImplementationOnce(async () => { throw new Error("synthetic-private-path"); });
    const response = await f.handlers.operations(command(cmd)); expect(response.status).toBe(200);
    const created = await response.json();
    expect(created).toMatchObject({ replayed: false, childTarget: null, snapshot: null, reconciliation: { state: "record_unavailable" } });
    expect(JSON.stringify(created)).not.toContain("synthetic-private-path"); media.mockRestore();
    const committed = await readFile(f.document, "utf8"); f.revokeCreation();
    const replay = await (await f.handlers.operations(command(cmd))).json();
    expect(replay).toEqual({ ...created, replayed: true, reconciliation: { state: "policy_unavailable" } });
    expect((await f.handlers.editor(request(), created.createdProjectId)).status).toBe(403);
    expect((await f.handlers.operations(command({ ...cmd, commandId: randomUUID() }))).status).toBe(403);
    expect(await readFile(f.document, "utf8")).toBe(committed);
  });

  it("fences policy revocation during asynchronous child projection while preserving the independent root source grant", async () => {
    const f = await fixture(false, undefined, undefined, undefined, true);
    const context = await (await f.handlers.editorCreation(request(), "project-a")).json();
    const cmd = { ...context, operation: "create_editor_project_from_source", commandId: randomUUID() };
    const originalMediaId = f.records.mediaId.bind(f.records);
    vi.spyOn(f.records, "mediaId").mockImplementationOnce(async (...args) => { const id = await originalMediaId(...args); f.revokeCreation(); return id; });
    const response = await f.handlers.operations(command(cmd)); expect(response.status).toBe(200);
    const created = await response.json(); expect(created.snapshot).toBeNull(); expect(created.childTarget).toBeNull();
    expect(created.reconciliation.state).toBe("record_unavailable");
    const rootSnapshot = await (await f.handlers.editor(request(), "project-a")).json();
    const sourceResponse = await f.handlers.media(request(), rootSnapshot.media.source.mediaId);
    expect(sourceResponse.status).toBe(200); expect(await sourceResponse.text()).toBe("0123456789");
    expect((await f.handlers.editor(request(), created.createdProjectId)).status).toBe(403);
  });

  it("rejects forged creation fields and foreign or read-only commands before changing the original document", async () => {
    const f = await fixture(false, undefined, undefined, undefined, true);
    const context = await (await f.handlers.editorCreation(request(), "project-a")).json();
    const cmd = { ...context, operation: "create_editor_project_from_source", commandId: randomUUID() };
    const before = await readFile(f.document, "utf8");
    for (const fields of [{ sourceFile: "foreign.mp4" }, { createdProjectId: "caller-id" }, { policy: {} }, { sourceDigest: "bad" }]) {
      expect((await f.handlers.operations(command({ ...cmd, ...fields }))).status).toBe(400);
    }
    for (const user of ["other", "read-only"]) expect((await f.handlers.operations(command(cmd, user))).status).toBe(403);
    expect(await readFile(f.document, "utf8")).toBe(before); expect(f.base.execute).not.toHaveBeenCalled();
  });

  it("streams bound original music privately, preserves it through redacted saves, and revokes the old revision", async () => {
    const f = await fixture(false, "png", undefined, { enabled: true });
    const before = await readFile(f.document, "utf8");
    const initialResponse = await f.handlers.editor(request("editor/project-a"), "project-a");
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json();
    expect(initial.requiresAssetConnection).toBe(false);
    expect(initial.project.audio.musicSrc).toBeUndefined(); expect(initial.media.overlays).toHaveLength(1);
    expect(Object.keys(initial.media.music).sort()).toEqual(["mediaId", "url"]);
    expect(JSON.stringify(initial)).not.toMatch(/data:audio|sourceRefSha256|sampleFrames/);
    const musicId = initial.media.music.mediaId;
    const audio = await f.handlers.media(request("media/opaque"), musicId);
    expect(audio.status).toBe(200); expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(audio.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(f.musicBytes);
    const ranged = request("media/opaque"); ranged.headers.set("range", "bytes=44-99");
    const head = await f.handlers.media(new Request(ranged, { method: "HEAD" }), musicId);
    expect(head.status).toBe(206); expect(head.headers.get("content-length")).toBe("56"); expect(await head.text()).toBe("");
    const range = await f.handlers.media(ranged, musicId);
    expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(f.musicBytes!.subarray(44, 100));
    expect((await f.handlers.media(request("media/opaque", "other"), musicId)).status).toBe(403);
    const invalidRange = request("media/opaque"); invalidRange.headers.set("range", "bytes=999999-");
    expect((await f.handlers.media(invalidRange, musicId)).status).toBe(416);
    expect(await readFile(f.document, "utf8")).toBe(before);
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: initial.target,
      project: { ...initial.project, audio: { ...initial.project.audio, musicVolume: 0.2 } } };
    const saveResponse = await f.handlers.operations(command(save)); expect(saveResponse.status).toBe(200);
    const saved = await saveResponse.json();
    const stored = JSON.parse(await readFile(f.document, "utf8")).clipProjects[0];
    expect(stored.audio.musicSrc).toBe(f.project.audio.musicSrc); expect(stored.audio.musicName).toBe(f.project.audio.musicName);
    expect(stored.audio.musicVolume).toBe(0.2); expect(stored.overlays[0].src).toBe(f.project.overlays[0].src);
    const afterSave = await readFile(f.document, "utf8");
    expect(await (await f.handlers.operations(command(save))).json()).toMatchObject({ replayed: true });
    expect(await readFile(f.document, "utf8")).toBe(afterSave);
    expect((await f.handlers.media(new Request(ranged, { method: "HEAD" }), musicId)).status).toBe(404);
    expect((await f.handlers.media(invalidRange, musicId)).status).toBe(404);
    expect((await f.handlers.media(request("media/opaque"), saved.snapshot.media.music.mediaId)).status).toBe(200);
    const changed = JSON.parse(afterSave); changed.clipProjects[0].audio.musicSrc = f.project.audio.musicSrc!.replace("audio/wav", "audio/x-wav");
    await writeFile(f.document, JSON.stringify(changed));
    expect((await f.handlers.media(request("media/opaque"), saved.snapshot.media.music.mediaId)).status).toBe(404);
    expect(await readdir(root)).not.toContain("publish-queue.json"); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ enabled: true, omitResolver: true }, { enabled: true, unsupported: true }])("keeps incomplete or unsupported mixed music/image capability closed: %j", async (music) => {
    const f = await fixture(false, "png", undefined, music);
    const before = await readFile(f.document, "utf8");
    const snapshot = await f.editor.load(owner, f.project.id);
    expect(snapshot.requiresAssetConnection).toBe(true);
    expect((await f.handlers.editor(request("editor/project-a"), "project-a")).status).toBe(503);
    expect((await f.handlers.operations(command({ operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, name: "Must not write" } }))).status).toBe(503);
    expect((await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target }))).status).toBe(503);
    expect(await readFile(f.document, "utf8")).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });

  it("prepares original mixed music/image edits through the real worker without changing the job or publication queue", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(true, "png", undefined, { enabled: true });
    const jobsBefore = await readFile(f.jobs, "utf8");
    const initial = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const exportedResponse = await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: initial.target }));
    expect(exportedResponse.status).toBe(200); const exported = await exportedResponse.json();
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: initial.target, requestId: exported.receipt.requestId });
    const proof = await f.worker!.prepare(f.project.id, exported.receipt.requestId, claimed.attemptId);
    expect(createHash("sha256").update(await readFile(proof.file)).digest("hex")).toBe(proof.artifactSha256);
    await f.editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome", commandId: randomUUID(), target: initial.target,
      requestId: exported.receipt.requestId, attemptId: claimed.attemptId, outcome: "prepared" });
    const current = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(current.export.state).toBe("prepared"); expect(current.media.music).toBeDefined(); expect(current.media.overlays).toHaveLength(1);
    const output = await f.handlers.media(request("media/prepared"), current.media.edited.mediaId);
    expect(output.status).toBe(200); expect(createHash("sha256").update(Buffer.from(await output.arrayBuffer())).digest("hex")).toBe(proof.artifactSha256);
    const musicResolve = vi.spyOn(f.musicAssets!, "resolve");
    const preparedRange = request("media/prepared"); preparedRange.headers.set("range", "bytes=0-31");
    const preparedHead = await f.handlers.media(new Request(preparedRange, { method: "HEAD" }), current.media.edited.mediaId);
    expect(preparedHead.status).toBe(206); expect(await preparedHead.text()).toBe("");
    const preparedPart = await f.handlers.media(preparedRange, current.media.edited.mediaId);
    expect(preparedPart.status).toBe(206); expect(Buffer.from(await preparedPart.arrayBuffer())).toEqual((await readFile(proof.file)).subarray(0, 32));
    expect(musicResolve).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].audio.musicSrc).toBe(f.project.audio.musicSrc);
    const preparedDocument = await readFile(f.document, "utf8");
    const changed = JSON.parse(preparedDocument); changed.clipProjects[0].audio.musicVolume = 0.8;
    await writeFile(f.document, JSON.stringify(changed));
    expect((await f.handlers.media(new Request(preparedRange, { method: "HEAD" }), current.media.edited.mediaId)).status).toBe(404);
    expect(musicResolve).not.toHaveBeenCalled();
    // Restore only this isolated fixture to exercise same-revision supersession.
    await writeFile(f.document, preparedDocument);
    const fresh = await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: initial.target }));
    expect(fresh.status).toBe(200); expect((await fresh.json()).receipt.requestId).not.toBe(exported.receipt.requestId);
    musicResolve.mockClear();
    expect((await f.handlers.media(new Request(preparedRange, { method: "HEAD" }), current.media.edited.mediaId)).status).toBe(404);
    expect((await f.handlers.media(preparedRange, current.media.edited.mediaId)).status).toBe(404);
    expect(musicResolve).not.toHaveBeenCalled(); musicResolve.mockRestore();
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore); expect(await readdir(root)).not.toContain("publish-queue.json"); expect(fetch).not.toHaveBeenCalled();
  }, 60_000);

  it("routes a public stop through the actual preparation worker before an uncommitted render can become ready", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(true);
    const jobsBefore = await readFile(f.jobs, "utf8");
    const target = (await f.editor.load(owner, f.project.id)).target;
    const requested = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target }))).json();
    const requestId = requested.receipt.requestId;
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target, requestId });
    const proof = await f.worker!.prepare(f.project.id, requestId, claimed.attemptId);
    expect(createHash("sha256").update(await readFile(proof.file)).digest("hex")).toBe(proof.artifactSha256);
    const stop = { operation: "cancel_editor_export", commandId: randomUUID(), target, requestId, attemptId: claimed.attemptId };
    const response = await f.handlers.operations(command(stop));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ receipt: { commandId: stop.commandId, state: "cancel_requested" },
      snapshot: null, reconciliation: { state: "refresh_required" } });
    const persisted = JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor;
    expect(persisted.exports[0].state).toBe("canceled");
    expect(persisted.exports[0].cancellation.commandId).toBe(stop.commandId);
    await expect(f.editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome", commandId: randomUUID(),
      target, requestId, attemptId: claimed.attemptId, outcome: "prepared" })).rejects.toThrow();
    const current = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(current.export.state).toBe("canceled"); expect(current.media.edited).toBeUndefined();
    expect((await f.handlers.media(request("media/opaque"), `prepared:project-a:${requestId}`)).status).toBe(404);
    expect(await (await f.handlers.operations(command(stop))).json()).toMatchObject({ replayed: true, receipt: { state: "cancel_requested" } });
    expect(JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor.receipts).toHaveLength(persisted.receipts.length);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore); expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
  }, 60_000);
  it("cancels an undispatched original intent without needing its source preview or creating a worker attempt", async () => {
    const f = await fixture();
    const initial = await f.editor.load(owner, f.project.id);
    const requested = await f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: initial.target });
    await writeFile(f.jobs, "[]");
    const body = { operation: "cancel_editor_export", commandId: randomUUID(), target: initial.target, requestId: requested.receipt.requestId };
    const response = await f.handlers.operations(command(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ receipt: { operation: body.operation, state: "canceled", commandId: body.commandId },
      snapshot: null, reconciliation: { state: "refresh_required" } });
    const beforeReplay = await readFile(f.document, "utf8");
    expect(await (await f.handlers.operations(command(body))).json()).toMatchObject({ replayed: true, receipt: { state: "canceled" } });
    expect(await readFile(f.document, "utf8")).toBe(beforeReplay);
    expect(await readFile(f.jobs, "utf8")).toBe("[]");
    expect(f.base.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["settled", "active", "abort_failure"] as const)("keeps the durable cancellation truthful with a %s trusted controller", async (mode) => {
    const workerEpoch = randomUUID(); let closed = false;
    const controls = {
      worker: { assertPreparationOnly() {}, getWorkerEpoch: () => workerEpoch,
        readPreparation: async () => null,
        inspectAttempt: async () => ({ workerEpoch, status: closed ? "settled" as const : "active" as const, assertCurrent() {} }),
        readCancellationSettlement: async (_project: unknown, intent: import("./editor").EditorExportIntent) => closed
          ? { workerEpoch, requestId: intent.requestId, attemptId: intent.attemptId!, cancelCommandId: intent.cancellation!.commandId,
            settled: true as const, assertCurrent() { expect(closed).toBe(true); } } : null },
      cancellation: { abortExact: vi.fn(async (_projectId: string, _requestId: string, _attemptId: string, _cancelCommandId: string) => {}) },
    };
    const f = await fixture(false, undefined, controls);
    const target = (await f.editor.load(owner, f.project.id)).target;
    const requested = await f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target });
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const requestId = requested.receipt.requestId!;
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target, requestId });
    const body = { operation: "cancel_editor_export", commandId: randomUUID(), target, requestId, attemptId: claimed.attemptId };
    controls.cancellation.abortExact.mockImplementation(async (projectId, requestedId, attemptId, cancelCommandId) => {
      const stored = JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor;
      expect([projectId, requestedId, attemptId, cancelCommandId]).toEqual([f.project.id, requestId, claimed.attemptId, body.commandId]);
      expect(stored.exports[0].cancellation.commandId).toBe(body.commandId);
      expect(["cancel_requested", "canceled"]).toContain(stored.exports[0].state);
      if (mode === "abort_failure") throw new Error("synthetic-controller-detail-must-not-leak");
      if (mode === "settled") closed = true;
    });
    const beforeDenied = await readFile(f.document, "utf8");
    expect((await f.handlers.operations(command(body, "other"))).status).toBe(403);
    expect(controls.cancellation.abortExact).not.toHaveBeenCalled();
    expect(await readFile(f.document, "utf8")).toBe(beforeDenied);
    // Cancellation never waits for source/media projection after its commit.
    await writeFile(f.jobs, "[]");
    const first = await f.handlers.operations(command(body));
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result).toMatchObject({ receipt: { state: "cancel_requested", commandId: body.commandId, cancelCommandId: body.commandId },
      snapshot: null, reconciliation: { state: "refresh_required" } });
    expect(JSON.stringify(result)).not.toContain("synthetic-controller-detail");
    const persisted = JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor;
    expect(persisted.exports[0].state).toBe(mode === "settled" ? "canceled" : "cancel_requested");
    const receiptCount = persisted.receipts.length;
    expect(await (await f.handlers.operations(command(body))).json()).toMatchObject({ replayed: true, receipt: result.receipt });
    expect(JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor.receipts).toHaveLength(receiptCount);
    if (mode === "active") {
      closed = true;
      const reconciled = await f.handlers.operations(command({ operation: "reconcile_editor_export", commandId: randomUUID(),
        target, requestId, attemptId: claimed.attemptId }));
      expect(reconciled.status).toBe(200);
      expect(await reconciled.json()).toMatchObject({ receipt: { state: "canceled" }, snapshot: null });
      expect(JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor.exports[0].state).toBe("canceled");
    }
    expect(await readFile(f.jobs, "utf8")).toBe("[]");
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(f.base.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["png", "jpeg", "webp"] as const)("previews, saves and prepares an original-store %s through scoped opaque media without replacing asset refs", async (format) => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(true, format);
    const jobsBefore = await readFile(f.jobs, "utf8");
    const initial = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(initial.project.overlays[0].src).toBeUndefined(); expect(initial.media.overlays).toHaveLength(1);
    expect(JSON.stringify(initial)).not.toContain("/api/clips/overlay-images/");
    const imageId = initial.media.overlays[0].mediaId;
    const image = await f.handlers.media(request("media/opaque"), imageId);
    expect(image.status).toBe(200); expect(Buffer.from(await image.arrayBuffer())).toEqual(f.image!.bytes);
    const rangeRequest = request("media/opaque"); rangeRequest.headers.set("range", "bytes=2-8");
    const head = await f.handlers.media(new Request(rangeRequest, { method: "HEAD" }), imageId);
    expect(head.status).toBe(206); expect(head.headers.get("content-length")).toBe("7"); expect(await head.text()).toBe("");
    const range = await f.handlers.media(rangeRequest, imageId);
    expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(f.image!.bytes.subarray(2, 9));
    const saveResponse = await f.handlers.operations(command({ operation: "save_editor_project", commandId: randomUUID(), target: initial.target,
      project: { ...initial.project, overlays: [{ ...initial.project.overlays[0], x: 0.3 }] } }));
    expect(saveResponse.status).toBe(200); const saved = await saveResponse.json();
    const stored = JSON.parse(await readFile(f.document, "utf8")).clipProjects[0];
    expect(stored.overlays[0].src).toBe(f.project.overlays[0].src);
    expect((await f.handlers.media(request("media/opaque"), imageId)).status).toBe(404);
    const exported = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: saved.snapshot.target }))).json();
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: saved.snapshot.target,
      requestId: exported.receipt.requestId });
    const proof = await f.worker!.prepare(f.project.id, exported.receipt.requestId, claimed.attemptId);
    await f.editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome", commandId: randomUUID(), target: saved.snapshot.target,
      requestId: exported.receipt.requestId, attemptId: claimed.attemptId, outcome: "prepared" });
    const final = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(final.export.state).toBe("prepared");
    const video = await f.handlers.media(request("media/opaque"), final.media.edited.mediaId);
    expect(video.status).toBe(200);
    expect(createHash("sha256").update(new Uint8Array(await video.arrayBuffer())).digest("hex")).toBe(proof.artifactSha256);
    const { runFfmpeg } = await import("@/lib/clipping/ffmpeg");
    const decoded = path.join(path.dirname(proof.file), "image-frame.rgb");
    await runFfmpeg(["-y", "-ss", "0.3", "-i", proof.file, "-frames:v", "1", "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", decoded]);
    const pixels = await readFile(decoded); const center = (80 * 160 + 48) * 3;
    expect(pixels[center]).toBeGreaterThan(220); expect(pixels[center + 1]).toBeLessThan(40);
    await writeFile(f.image!.file, Buffer.alloc(f.image!.bytes.length));
    expect((await f.handlers.media(request("media/opaque"), final.media.overlays[0].mediaId)).status).toBe(404);
    expect((await f.handlers.media(request("media/opaque"), final.media.edited.mediaId)).status).toBe(404);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore); expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
  }, 60_000);
  it.each(["svg", "local_audio"] as const)("refuses an incomplete %s asset preview without mutating the original project", async (kind) => {
    const f = await fixture();
    const data = JSON.parse(await readFile(f.document, "utf8"));
    if (kind === "svg") data.clipProjects[0].overlays = [{ id: "overlay-a", kind: "image", src: "data:image/svg+xml;base64,PHN2Zy8+", x: 0.5, y: 0.5, width: 0.25, scale: 1, start: 0, end: 10, rotation: 0, opacity: 1 }];
    else data.clipProjects[0].audio.musicSrc = "C:\\synthetic-private\\music.wav";
    await writeFile(f.document, JSON.stringify(data));
    const before = await readFile(f.document, "utf8");
    const jobsBefore = await readFile(f.jobs, "utf8");
    const internal = await f.editor.load(owner, f.project.id);
    expect(internal.requiresAssetConnection).toBe(true);
    expect(JSON.stringify(internal)).not.toContain("synthetic-private");
    const loaded = await f.handlers.editor(request("editor/project-a"), "project-a");
    expect(loaded.status).toBe(503);
    for (const operation of ["save_editor_project", "request_editor_export"]) {
      const response = await f.handlers.operations(command({ operation, commandId: randomUUID(), target: internal.target,
        ...(operation === "save_editor_project" ? { project: internal.project } : {}) }));
      expect(response.status).toBe(503);
      expect((await response.json()).error.outcome).toBe("failed");
    }
    expect(await readFile(f.document, "utf8")).toBe(before);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
    const workspace = await (await f.handlers.workspace(request())).json();
    const deleted = await f.handlers.operations(command({ operation: "delete_editor_project", commandId: randomUUID(), target: workspace.editorProjects[0].deleteTarget }));
    expect(deleted.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders a captioned original project through the trusted worker and streams verified prepared bytes without job attachment", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(true);
    const jobsBefore = await readFile(f.jobs, "utf8");
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const exported = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target }))).json();
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const requestId = exported.receipt.requestId;
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: snapshot.target, requestId });
    const proof = await f.worker!.prepare(f.project.id, requestId, claimed.attemptId);
    await f.editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome", commandId: randomUUID(),
      target: snapshot.target, requestId, attemptId: claimed.attemptId, outcome: "prepared" });
    const prepared = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(prepared.export.state).toBe("prepared");
    expect(prepared.media.edited).toMatchObject({ current: true, renderSignature: snapshot.target.renderSignature });
    expect(prepared.media.edited.mediaId).toBe(`prepared:project-a:${requestId}`);
    const media = await f.handlers.media(request("media/opaque"), prepared.media.edited.mediaId);
    expect(media.status).toBe(200);
    expect(createHash("sha256").update(new Uint8Array(await media.arrayBuffer())).digest("hex")).toBe(proof.artifactSha256);
    expect((await f.handlers.media(request("media/opaque", "other"), prepared.media.edited.mediaId)).status).toBe(403);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
    const deletion = { operation: "delete_editor_project", commandId: randomUUID(), target: prepared.target };
    const deleted = await f.handlers.operations(command(deletion));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ snapshot: null, reconciliation: { state: "deleted" } });
    expect((await f.handlers.media(request("media/opaque"), prepared.media.edited.mediaId)).status).toBe(404);
    expect((await f.handlers.editor(request("editor/project-a"), "project-a")).status).toBe(404);
    const replay = await (await f.handlers.operations(command(deletion))).json();
    expect(replay).toMatchObject({ replayed: true, snapshot: null, reconciliation: { state: "deleted" } });
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
  }, 60_000);

  it("deletes an explicitly scoped orphan through HTTP without media preflight or touching its original jobs", async () => {
    const f = await fixture();
    await writeFile(f.jobs, "[]");
    const workspace = await (await f.handlers.workspace(request())).json();
    const target = workspace.editorProjects[0].deleteTarget;
    expect(target.projectId).toBe("project-a");
    const deletion = { operation: "delete_editor_project", commandId: randomUUID(), target };
    expect((await f.handlers.operations(command(deletion, "other"))).status).toBe(403);
    const firstResponse = await f.handlers.operations(command(deletion));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ snapshot: null, reconciliation: { state: "deleted" }, receipt: { revision: target.revision + 1 } });
    const replay = await (await f.handlers.operations(command(deletion))).json();
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.replayed).toBe(true);
    expect((await (await f.handlers.workspace(request())).json()).editorProjects).toEqual([]);
    expect(await readFile(f.jobs, "utf8")).toBe("[]");
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passively projects original saved clips, captions and range media without worker initialization or mutation", async () => {
    const f = await fixture();
    const before = await readFile(f.document, "utf8");
    const jobsBefore = await readFile(f.jobs, "utf8");
    const workspace = await (await f.handlers.workspace(request())).json();
    expect(workspace.records.clipJobs[0]).toMatchObject({ status: "queued", progress: 12 });
    expect(workspace.editorProjects).toHaveLength(1);
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(snapshot.project.captions[0].text).toBe("Corrected caption");
    expect(snapshot.cachedCaptions.captions[0].text).toBe("Cached source");
    expect(snapshot.media.source).toEqual({ mediaId: "clip:job-a:clip-a:clip_master", url: "/api/marketing/media/clip%3Ajob-a%3Aclip-a%3Aclip_master" });
    expect(JSON.stringify(snapshot)).not.toContain("token=fixture");
    const ranged = request("media/opaque"); ranged.headers.set("Range", "bytes=2-5");
    const response = await f.handlers.media(ranged, snapshot.media.source.mediaId);
    expect(response.status).toBe(206); expect(await response.text()).toBe("2345");
    const head = await f.handlers.media(new Request(ranged, { method: "HEAD" }), snapshot.media.source.mediaId);
    expect(head.status).toBe(206); expect(await head.text()).toBe("");
    expect(await readFile(f.document, "utf8")).toBe(before);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
    expect(await readdir(root)).toEqual(["capital-command.json", "clips"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads, edits full captions, saves once, replays and requests export in the same original project", async () => {
    const f = await fixture();
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, captions: [{ ...snapshot.project.captions[0], text: "Precisely edited", start: 1.25 }] } };
    const firstResponse = await f.handlers.operations(command(save));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.snapshot.target.revision).toBe(1);
    const replay = await (await f.handlers.operations(command(save))).json();
    expect(replay.replayed).toBe(true); expect(replay.receipt).toEqual(first.receipt);
    expect((await f.handlers.operations(command({ ...save, commandId: randomUUID() }))).status).toBe(409);
    const exportResult = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: first.snapshot.target }))).json();
    expect(exportResult.snapshot.export.state).toBe("pending_dispatch");
    expect(exportResult.snapshot.publicationAuthorized).toBe(false);
    const disk = JSON.parse(await readFile(f.document, "utf8"));
    expect(disk.clipProjects).toHaveLength(1);
    expect(disk.clipProjects[0].captions[0].text).toBe("Precisely edited");
    expect(disk.clipProjects[0].marketingEditor.receipts).toHaveLength(2);
    expect(JSON.parse(await readFile(f.jobs, "utf8"))[0].status).toBe("queued");
    expect(f.base.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects foreign access, injected worker operations and client owner authority before modifying records", async () => {
    const f = await fixture(); const before = await readFile(f.document, "utf8");
    expect((await f.handlers.workspace(request("workspace", "other"))).status).toBe(403);
    expect((await f.handlers.editor(request("editor/project-a", "other"), "project-a")).status).toBe(403);
    expect((await f.handlers.media(request("media/opaque", "other"), "clip:job-a:clip-a:clip_master")).status).toBe(403);
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    for (const operation of ["claim_editor_export", "record_editor_export_outcome", "startExport", "publish"]) {
      expect((await f.handlers.operations(command({ operation, commandId: randomUUID(), target: snapshot.target }))).status).toBe(400);
    }
    expect((await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: { ...snapshot.target, ownerId: owner.ownerId } }))).status).toBe(400);
    expect(await readFile(f.document, "utf8")).toBe(before);
  });

  it("preserves uncertain command identity when preview scope changes after a committed save", async () => {
    const f = await fixture();
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "Recorded before preview failure" } };
    const media = vi.spyOn(f.records, "mediaId");
    media.mockResolvedValueOnce("clip:job-a:clip-a:clip_master").mockResolvedValueOnce(null);
    const response = await f.handlers.operations(command(save));
    expect(response.status).toBe(503);
    expect((await response.json()).error.outcome).toBe("uncertain");
    expect(JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor.receipts).toHaveLength(1);
    media.mockRestore();
    const replay = await (await f.handlers.operations(command(save))).json();
    expect(replay.replayed).toBe(true); expect(replay.receipt.commandId).toBe(save.commandId);
  });

  it("reconciles a recorded save even after its original job/media is removed", async () => {
    const f = await fixture();
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "Durable command receipt" } };
    const first = await (await f.handlers.operations(command(save))).json();
    await writeFile(f.jobs, "[]");
    const before = await readFile(f.document, "utf8");
    const replay = await f.handlers.operations(command(save));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ receipt: first.receipt, replayed: true, snapshot: null,
      reconciliation: { state: "record_unavailable" } });
    expect(await readFile(f.document, "utf8")).toBe(before);
    expect((await f.handlers.operations(command({ ...save, commandId: randomUUID() }))).status).not.toBe(200);
  });

  it("fails closed on a malformed original store and unconfigured preparation", async () => {
    const f = await fixture();
    expect((await f.handlers.operations(command({ operation: "prepare_source", commandId: randomUUID(), runId: `site-${randomUUID()}`, expectedRevision: 1, sourceId: "source-a" }))).status).toBe(503);
    await writeFile(f.jobs, "malformed original data");
    const workspace = await (await f.handlers.workspace(request())).json();
    expect(workspace.records.stores).toContainEqual({ store: "clip_jobs", state: "unavailable", reason: "malformed" });
    expect((await f.handlers.editor(request("editor/project-a"), "project-a")).status).toBe(503);
    expect(await readFile(f.jobs, "utf8")).toBe("malformed original data");
  });
});
