import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, ClipProject } from "@/types/domain";
import type { ClipJob } from "@/lib/clipping/types";
import type { EditorPreparationEvidence, EditorStore, EditorWorkerPorts } from "./editor";
import type { EditorExportIntent, EditorMusicAssetIdentity, EditorSnapshot } from "./editor-types";
import type { Principal } from "./safety";

const owner: Principal = { ownerId: "synthetic-music-owner", scopes: ["read", "write"] };
const worker: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
const epoch = "11111111-1111-4111-8111-111111111111";
const binding = { ownerId: owner.ownerId, records: [{ projectId: "music-project", jobId: "music-job", clipId: "music-clip", sourceFile: "source.mp4" }] };
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
let root: string;
let api: typeof import("./editor");
let storage: typeof import("@/lib/storage/store");
let audio: typeof import("./editor-audio-assets");
const document = () => path.join(root, "capital-command.json");
const jobs = () => path.join(root, "clips", "jobs.json");
const disk = async (): Promise<AppData> => JSON.parse(await readFile(document(), "utf8"));

function wav(frequency = 440): Buffer {
  const frames = 800, sampleRate = 8000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(Math.round(Math.sin(frame * 2 * Math.PI * frequency / sampleRate) * 2000), 44 + frame * 2);
  return bytes;
}
const dataUrl = (bytes: Buffer) => `data:audio/wav;base64,${bytes.toString("base64")}`;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "editor-stored-music-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in music metadata fixtures."); }));
  vi.resetModules();
  api = await import("./editor"); storage = await import("@/lib/storage/store"); audio = await import("./editor-audio-assets");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(options: { source?: string | null; images?: boolean; noMusicResolver?: boolean; noImageResolver?: boolean } = {}) {
  const { appDataSchema, clipProjectSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const { createCanvas } = await import("@napi-rs/canvas");
  const { createStoredEditorOverlayResolver } = await import("./editor-overlay-assets");
  const source = options.source === undefined ? dataUrl(wav()) : options.source ?? undefined;
  const project = clipProjectSchema.parse({ id: "music-project", jobId: "music-job", name: "Synthetic stored music", sourceFile: "source.mp4",
    sourceUrl: "", baseDurationSec: 2, clipStart: 10, clipEnd: 12, trimStart: 0, trimEnd: 2,
    captions: [{ id: "manual-caption", start: 0, end: 1, text: "Manual words", words: [], enabled: true }],
    audio: { musicSrc: source, musicName: "C:\\private-fixture\\original.wav", musicVolume: 0.5 },
    createdAt: "2026-10-21T12:00:00.000Z", updatedAt: "2026-10-21T12:00:00.000Z" });
  if (options.images) {
    const bytes = createCanvas(2, 2).toBuffer("image/png");
    const name = `${createHash("sha1").update(bytes).digest("hex")}.png`;
    await mkdir(path.join(root, "overlay-images"), { recursive: true }); await writeFile(path.join(root, "overlay-images", name), bytes);
    project.overlays = [{ id: "stored-image", kind: "image", src: `/api/clips/overlay-images/${name}`,
      x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, z: 0, locked: false, start: 0, end: 2 }];
  }
  const unrelated = { ...structuredClone(project), id: "unrelated-project", jobId: "other-job", sourceFile: "other.mp4" };
  const data = appDataSchema.parse({ ...emptyData, clipProjects: [project, unrelated] });
  const job: ClipJob = { id: project.jobId, sourceUrl: "", fileName: "Synthetic source", status: "queued", stage: "downloading", progress: 0,
    createdAt: project.createdAt, notices: [], clips: [{ id: "music-clip", start: 10, end: 12, file: project.sourceFile,
      score: 50, rationale: "Synthetic", breakdown: { hook: 50, pacing: 50, standalone: 50, intensity: 50 } }] };
  await mkdir(path.dirname(jobs()), { recursive: true }); await writeFile(document(), JSON.stringify(data)); await writeFile(jobs(), JSON.stringify([job]));
  const jobsBefore = await readFile(jobs(), "utf8");
  let beforeCommit: ((project: ClipProject) => void) | undefined;
  let afterCommit: (() => void) | undefined;
  let locked = false;
  const store: EditorStore = { read: storage.readExistingAppData, readJob: api.readOriginalEditorJob,
    mutate: async (id, update) => {
      const saved = await storage.mutateExistingClipProject(id, (current) => {
        const before = beforeCommit; beforeCommit = undefined; before?.(current); locked = true;
        try { return update(current); } finally { locked = false; }
      });
      const after = afterCommit; afterCommit = undefined; after?.(); return saved;
    } };
  const resolver = audio.createStoredEditorMusicResolver({ binding, store });
  const guardCalls: boolean[] = [];
  const musicAssets = { resolve: vi.fn(async (target: EditorSnapshot["target"]) => {
    const asset = await resolver.resolve(target);
    return asset && { ...asset, assertCurrentProject: (current: Readonly<ClipProject>) => {
      guardCalls.push(locked); asset.assertCurrentProject(current);
    } };
  }) };
  const overlayAssets = createStoredEditorOverlayResolver({ binding, store });
  const ports: EditorWorkerPorts = { assertPreparationOnly: vi.fn(), getWorkerEpoch: () => epoch,
    readPreparation: vi.fn(async (_project, intent) => evidence(intent)),
    inspectAttempt: async () => ({ workerEpoch: epoch, status: "missing", assertCurrent() {} }) };
  const evidence = (intent: Readonly<EditorExportIntent>): EditorPreparationEvidence => ({ requestId: intent.requestId, attemptId: intent.attemptId!,
    digest: intent.digest, renderSignature: intent.renderSignature, exportId: "synthetic-proof", artifactSha256: "a".repeat(64),
    ...(intent.overlayAssets ? { overlayAssets: structuredClone(intent.overlayAssets) } : {}),
    ...(intent.musicAsset ? { musicAsset: structuredClone(intent.musicAsset) } : {}), assertCurrent: vi.fn() });
  const editor = new api.MarketingEditor({ binding, store, worker: ports,
    ...(!options.noMusicResolver ? { musicAssets } : {}), ...(!options.noImageResolver ? { overlayAssets } : {}) });
  return { project, data, source, store, resolver, musicAssets, overlayAssets, ports, editor, guardCalls, evidence,
    beforeCommit: (callback: (current: ClipProject) => void) => { beforeCommit = callback; },
    afterCommit: (callback: () => void) => { afterCommit = callback; },
    async assertIsolated() { expect((await disk()).clipProjects[1]).toEqual(data.clipProjects[1]);
      expect(await readFile(jobs(), "utf8")).toBe(jobsBefore); expect(fetch).not.toHaveBeenCalled();
      expect(await readdir(root)).not.toContain("publish-queue.json"); } };
}
const save = (snapshot: EditorSnapshot, overrides: Partial<ClipProject> = {}, commandId = randomUUID()) => ({
  operation: "save_editor_project" as const, commandId, target: snapshot.target, project: { ...snapshot.project, ...overrides }
});
async function requested(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = await f.editor.load(owner, f.project.id);
  const command = { operation: "request_editor_export" as const, commandId: randomUUID(), target: snapshot.target };
  const request = await f.editor.requestExport(owner, command);
  return { snapshot, command, request, requestId: command.commandId };
}
async function claimed(f: Awaited<ReturnType<typeof fixture>>) {
  const request = await requested(f);
  const claim = await f.editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: request.snapshot.target, requestId: request.requestId });
  return { ...request, claim, outcome: { operation: "record_editor_export_outcome" as const, commandId: randomUUID(), target: request.snapshot.target,
    requestId: request.requestId, attemptId: claim.attemptId, outcome: "prepared" as const } };
}

describe("existing original editor music metadata", () => {
  it("projects only verified private metadata and preserves exact redacted music bytes/name on numeric save", async () => {
    const f = await fixture({ images: true });
    const before = await readFile(document(), "utf8");
    const snapshot = await f.editor.load(owner, f.project.id);
    expect(await readFile(document(), "utf8")).toBe(before);
    expect(snapshot.requiresAssetConnection).toBe(false); expect(snapshot.media.overlays).toHaveLength(1);
    expect(snapshot.media.music).toMatchObject({ slot: "background_music", sha256: sha(wav()), sourceRefSha256: sha(f.source!), demuxer: "wav" });
    expect(snapshot.project.audio.musicSrc).toBeUndefined(); expect(snapshot.project.audio.musicName).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toMatch(/data:audio|private-fixture|copyBytes|assertCurrentProject/);
    const result = await f.editor.save(owner, save(snapshot, { audio: { ...snapshot.project.audio, musicVolume: 0.25, clipVolume: 0.7 } }));
    const stored = (await disk()).clipProjects[0];
    expect(stored.audio.musicSrc).toBe(f.source); expect(stored.audio.musicName).toBe(f.project.audio.musicName);
    expect(stored.audio.musicVolume).toBe(0.25); expect(result.snapshot?.requiresAssetConnection).toBe(false);
    const { editorProjectDigest, editorRenderSignature } = await import("./editor-state");
    expect(stored.marketingEditor?.digest).toBe(editorProjectDigest(stored)); expect(stored.marketingEditor?.renderSignature).toBe(editorRenderSignature(stored));
    expect(f.guardCalls).toContain(true); await f.assertIsolated();
  });

  it.each(["music", "image"] as const)("closes mixed preview/save/export completely without the %s resolver", async (missing) => {
    const f = await fixture({ images: true, noMusicResolver: missing === "music", noImageResolver: missing === "image" });
    const snapshot = await f.editor.load(owner, f.project.id); const before = await readFile(document(), "utf8");
    expect(snapshot.requiresAssetConnection).toBe(true); expect(snapshot.media.music).toBeUndefined(); expect(snapshot.media.overlays).toBeUndefined();
    expect(snapshot.capabilities.save).toBe(false); expect(snapshot.capabilities.requestExport).toBe(false); expect(snapshot.capabilities.deleteProject).toBe(true);
    await expect(f.editor.save(owner, save(snapshot, { title: "Cannot hide asset failure" }))).rejects.toMatchObject({ code: "unavailable" });
    await expect(f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target })).rejects.toMatchObject({ code: "unavailable" });
    expect(await readFile(document(), "utf8")).toBe(before); await f.assertIsolated();
  });

  it.each([
    { name: "MP3", source: "data:audio/mpeg;base64,aGVsbG8=" },
    { name: "URL", source: "https://invalid.example/private.wav" },
    { name: "invalid container", source: "data:audio/wav;base64,bm90LWEtd2F2" },
    { name: "noncanonical base64", source: dataUrl(wav()).replace("base64,", "base64, ") }
  ])("closes unsupported stored $name without omitting the attachment", async ({ source }) => {
    const f = await fixture({ source }); const snapshot = await f.editor.load(owner, f.project.id);
    expect(snapshot.requiresAssetConnection).toBe(true); expect(snapshot.media.music).toBeUndefined();
    const before = await readFile(document(), "utf8");
    await expect(f.editor.save(owner, save(snapshot))).rejects.toBeDefined();
    await expect(f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target })).rejects.toBeDefined();
    expect(await readFile(document(), "utf8")).toBe(before); await f.assertIsolated();
  });

  it("rejects attachment promotion and source substitutions instead of treating redaction as removal", async () => {
    for (const source of [null, dataUrl(wav())]) {
      const f = await fixture({ source }); const snapshot = await f.editor.load(owner, f.project.id); const before = await readFile(document(), "utf8");
      for (const replacement of [dataUrl(wav(880)), "C:\\private\\replacement.wav", "https://invalid.example/track.wav", ""]) {
        await expect(f.editor.save(owner, save(snapshot, { audio: { ...snapshot.project.audio, musicSrc: replacement } }))).rejects.toMatchObject({ code: "invalid" });
      }
      expect(await readFile(document(), "utf8")).toBe(before); await f.assertIsolated();
    }
  });

  it("checks owner and exact enrollment before any resolver/store read", async () => {
    const f = await fixture(); const read = vi.fn(f.store.read); const resolve = vi.fn(f.musicAssets.resolve);
    const editor = new api.MarketingEditor({ binding, store: { ...f.store, read }, musicAssets: { resolve } });
    await expect(editor.load({ ...owner, ownerId: "other-owner" }, f.project.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(editor.load(owner, "unrelated-project")).rejects.toMatchObject({ code: "forbidden" });
    expect(read).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); await f.assertIsolated();
  });

  it("persists the same strict manifest through request, claim and independently matching outcome", async () => {
    const f = await fixture({ images: true }); const result = await claimed(f);
    const intent = (await disk()).clipProjects[0].marketingEditor!.exports[0];
    expect(intent.musicAsset).toEqual(result.request.snapshot!.media.music); expect(intent.overlayAssets).toHaveLength(1);
    expect(intent.workerEpoch).toBe(epoch); expect(intent.state).toBe("claimed");
    const completed = await f.editor.recordExportOutcome(worker, result.outcome);
    const after = (await disk()).clipProjects[0].marketingEditor!.exports[0];
    expect(after.state).toBe("prepared"); expect(after.musicAsset).toEqual(intent.musicAsset); expect(after.overlayAssets).toEqual(intent.overlayAssets);
    expect(completed.receipt.publicationAuthorized).toBe(false); expect(f.guardCalls.filter(Boolean).length).toBeGreaterThanOrEqual(3); await f.assertIsolated();
  });

  it.each(["missing", "different"] as const)("refuses %s music identity from an otherwise matching worker proof", async (kind) => {
    const f = await fixture(); const result = await claimed(f);
    vi.mocked(f.ports.readPreparation).mockImplementationOnce(async (_project, intent) => {
      const evidence = f.evidence(intent); evidence.musicAsset = kind === "missing" ? undefined : { ...intent.musicAsset!, sha256: "b".repeat(64) }; return evidence;
    });
    const before = await readFile(document(), "utf8");
    await expect(f.editor.recordExportOutcome(worker, result.outcome)).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(document(), "utf8")).toBe(before); await f.assertIsolated();
  });

  it("rejects changed requested music identity before claim and inside locked outcome commit", async () => {
    const f = await fixture(); const request = await requested(f);
    let data = await disk(); data.clipProjects[0].marketingEditor!.exports[0].musicAsset!.sha256 = "b".repeat(64); await writeFile(document(), JSON.stringify(data));
    await expect(f.editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: request.snapshot.target, requestId: request.requestId })).rejects.toMatchObject({ code: "conflict" });
    data.clipProjects[0].marketingEditor!.exports[0].musicAsset!.sha256 = sha(wav()); await writeFile(document(), JSON.stringify(data));
    const claim = await f.editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: request.snapshot.target, requestId: request.requestId });
    const before = await readFile(document(), "utf8");
    f.beforeCommit((current) => { current.audio.musicSrc = dataUrl(wav(880)); });
    await expect(f.editor.recordExportOutcome(worker, { operation: "record_editor_export_outcome", commandId: randomUUID(), target: request.snapshot.target,
      requestId: request.requestId, attemptId: claim.attemptId, outcome: "prepared" })).rejects.toBeDefined();
    expect(await readFile(document(), "utf8")).toBe(before); await f.assertIsolated();
  });

  it("never claims the same revision after stored music bytes changed", async () => {
    const f = await fixture(); const request = await requested(f); const data = await disk();
    data.clipProjects[0].audio.musicSrc = dataUrl(wav(880)); await writeFile(document(), JSON.stringify(data)); const before = await readFile(document(), "utf8");
    await expect(f.editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: request.snapshot.target, requestId: request.requestId })).rejects.toBeDefined();
    expect(await readFile(document(), "utf8")).toBe(before); expect((await disk()).clipProjects[0].marketingEditor!.exports[0].state).toBe("pending_dispatch"); await f.assertIsolated();
  });

  it("leaves a valid request pending if the claiming editor has no music resolver", async () => {
    const f = await fixture(); const request = await requested(f); const before = await readFile(document(), "utf8");
    const editor = new api.MarketingEditor({ binding, worker: f.ports });
    await expect(editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(), target: request.snapshot.target,
      requestId: request.requestId })).rejects.toMatchObject({ code: "unavailable" });
    expect(await readFile(document(), "utf8")).toBe(before); expect(f.ports.readPreparation).not.toHaveBeenCalled(); await f.assertIsolated();
  });

  it("keeps the known receipt when postcommit asset projection becomes unavailable", async () => {
    const f = await fixture(); const snapshot = await f.editor.load(owner, f.project.id);
    const command = { operation: "request_editor_export" as const, commandId: randomUUID(), target: snapshot.target };
    f.afterCommit(() => { f.musicAssets.resolve.mockRejectedValue(new Error("Synthetic postcommit resolver failure")); });
    const request = await f.editor.requestExport(owner, command);
    expect(request.receipt.requestId).toBe(command.commandId); expect(request.snapshot?.requiresAssetConnection).toBe(true);
    expect(request.snapshot?.media.music).toBeUndefined();
    const replay = await f.editor.requestExport(owner, command);
    expect(replay.replayed).toBe(true); expect(replay.receipt).toEqual(request.receipt);
    expect((await disk()).clipProjects[0].marketingEditor!.exports).toHaveLength(1); await f.assertIsolated();
  });

  it("keeps enabled SFX outside music export authority without dispatch", async () => {
    const f = await fixture(); const data = await disk(); data.clipProjects[0].sfx!.enabled = true; await writeFile(document(), JSON.stringify(data));
    const snapshot = await f.editor.load(owner, f.project.id); const before = await readFile(document(), "utf8");
    await expect(f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target })).rejects.toMatchObject({ code: "unavailable" });
    expect(await readFile(document(), "utf8")).toBe(before); expect(f.ports.readPreparation).not.toHaveBeenCalled(); await f.assertIsolated();
  });

  it("does not acknowledge a failed save and replays a committed request after a lost reply without asset access", async () => {
    const f = await fixture(); const snapshot = await f.editor.load(owner, f.project.id); const before = await readFile(document(), "utf8");
    f.beforeCommit(() => { throw new Error("Synthetic disk failure before commit"); });
    await expect(f.editor.save(owner, save(snapshot, { title: "Not committed" }))).rejects.toThrow("disk failure");
    expect(await readFile(document(), "utf8")).toBe(before);
    const command = { operation: "request_editor_export" as const, commandId: randomUUID(), target: snapshot.target };
    f.afterCommit(() => { throw new Error("Synthetic lost reply after durable commit"); });
    await expect(f.editor.requestExport(owner, command)).rejects.toThrow("lost reply");
    await unlink(jobs());
    const restarted = new api.MarketingEditor({ binding }); const replay = await restarted.requestExport(owner, command);
    expect(replay.replayed).toBe(true); expect(replay.receipt.requestId).toBe(command.commandId); expect(replay.snapshot).toBeNull();
    expect((await disk()).clipProjects[0].marketingEditor!.exports).toHaveLength(1); expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves music manifest through source-independent cancellation/reconciliation/deletion", async () => {
    const f = await fixture(); const result = await claimed(f); const manifest = (await disk()).clipProjects[0].marketingEditor!.exports[0].musicAsset;
    await unlink(jobs()); f.musicAssets.resolve.mockRejectedValue(new Error("Asset access forbidden during control operations"));
    const editor = new api.MarketingEditor({ binding, worker: f.ports });
    const cancel = { operation: "cancel_editor_export" as const, commandId: randomUUID(), target: result.snapshot.target, requestId: result.requestId, attemptId: result.claim.attemptId };
    expect((await editor.cancelExport(owner, cancel)).receipt.state).toBe("cancel_requested");
    const reconcile = await editor.reconcileExport(owner, { ...cancel, operation: "reconcile_editor_export", commandId: randomUUID() });
    expect(reconcile.receipt.state).toBe("uncertain"); const intent = (await disk()).clipProjects[0].marketingEditor!.exports[0];
    expect(intent.musicAsset).toEqual(manifest); expect(intent.cancellation?.commandId).toBe(cancel.commandId); expect(intent.reconciliation).toBeDefined();
    const summary = (await editor.list(owner))[0]; await editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: summary.deleteTarget });
    const deleted = (await disk()).clipProjects[0].marketingEditor!; expect(deleted.deletedAt).toBeDefined();
    expect(deleted.exports[0].musicAsset).toEqual(manifest); expect(deleted.exports[0].cancellation).toEqual(intent.cancellation);
    expect((await editor.cancelExport(owner, cancel)).replayed).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });

  it("strictly validates manifests and rejects client-supplied identity fields", async () => {
    const f = await fixture(); const result = await requested(f); const identity = result.request.snapshot!.media.music!;
    const { editorMusicAssetIdentitySchema, editorExportIntentSchema } = await import("./editor-types");
    expect(editorMusicAssetIdentitySchema.parse(identity)).toEqual(identity);
    for (const patch of [{ byteLength: identity.byteLength + 1 }, { durationSec: identity.durationSec + 0.01 }, { format: "mp3" }, { target: result.snapshot.target }]) {
      expect(editorMusicAssetIdentitySchema.safeParse({ ...identity, ...patch }).success).toBe(false);
    }
    expect(editorExportIntentSchema.safeParse({ ...(await disk()).clipProjects[0].marketingEditor!.exports[0], musicAsset: { ...identity, path: "C:\\private.wav" } }).success).toBe(false);
    await expect(f.editor.requestExport(owner, { ...result.command, commandId: randomUUID(), musicAsset: identity } as never)).rejects.toMatchObject({ code: "invalid" });
    const noMusic = await fixture({ source: null }); const noMusicResult = await claimed(noMusic);
    expect((await disk()).clipProjects[0].marketingEditor!.exports[0].musicAsset).toBeUndefined();
    vi.mocked(noMusic.ports.readPreparation).mockImplementationOnce(async (_project, intent) => ({ ...noMusic.evidence(intent), musicAsset: identity as EditorMusicAssetIdentity }));
    await expect(noMusic.editor.recordExportOutcome(worker, noMusicResult.outcome)).rejects.toMatchObject({ code: "conflict" });
  });
});
