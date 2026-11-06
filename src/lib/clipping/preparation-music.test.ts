import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { makeClipProject } from "./editor";
import { runFfmpeg, probeDuration } from "./ffmpeg";
import { getExport, preparationMusicAssetIdentity, preparationSpecDigest, prepareClipExport, startExport } from "./export";
import { createEditorPreparationWorker, editorPreparationSpec } from "@/lib/integrations/marketing/editor-renderer";
import { createStoredEditorMusicResolver } from "@/lib/integrations/marketing/editor-audio-assets";
import { editorProjectDigest, editorRenderSignature } from "@/lib/integrations/marketing/editor-state";
import { dataPath } from "@/lib/paths";
import { appDataSchema } from "@/lib/storage/schemas";
import { emptyData } from "@/lib/mockData/seed";
import type { ClipJob } from "./types";
import type { ClipProject } from "@/types/domain";
import type { EditorExportIntent } from "@/lib/integrations/marketing/editor-types";
import { MarketingEditor } from "@/lib/integrations/marketing/editor";
import { createStoredEditorOverlayResolver } from "@/lib/integrations/marketing/editor-overlay-assets";
import { createCanvas } from "@napi-rs/canvas";

const state = vi.hoisted(() => ({ attach: vi.fn(async () => undefined), enqueue: vi.fn(async () => undefined),
  fetch: vi.fn(() => { throw new Error("No network or provider calls in synthetic preparation."); }),
  calls: [] as { args: string[]; signal?: AbortSignal }[],
  phase: "" as "" | "after-render" | "scratch-conflict" | "scratch-change", entered: false,
  release: undefined as (() => void) | undefined, scratch: "" }));
vi.mock("@/lib/clipping/jobs", async () => {
  const { dataPath } = await import("@/lib/paths");
  return { outputDir: (id: string) => dataPath("clips", "outputs", id), workDir: (id: string) => dataPath("clips", "uploads", id),
    attachEditedClipRender: state.attach };
});
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: state.enqueue }));
vi.mock("./ffmpeg", async (original) => {
  const actual = await original<typeof import("./ffmpeg")>();
  return { ...actual, runFfmpeg: vi.fn(async (...args: Parameters<typeof actual.runFfmpeg>) => {
    state.calls.push({ args: [...args[0]], signal: args[1]?.signal });
    const result = await actual.runFfmpeg(...args);
    if (args[0].at(-1)?.endsWith("prepared.mp4") && (state.phase === "after-render" || state.phase === "scratch-change")) {
      const phase = state.phase; state.phase = "";
      if (phase === "scratch-change") {
        const { writeFile, readFile } = await import("node:fs/promises"); const bytes = await readFile(state.scratch); bytes[44] ^= 1; await writeFile(state.scratch, bytes);
      } else { state.entered = true; await new Promise<void>((done) => { state.release = done; }); }
    }
    return result;
  }) };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
    if (String(args[0]).endsWith(`${path.sep}music.wav`)) {
      state.scratch = String(args[0]);
      if (state.phase === "scratch-conflict") { state.phase = ""; await actual.writeFile(args[0], "preexisting synthetic scratch file"); }
    }
    return actual.writeFile(...args);
  }) };
});
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
afterEach(() => { state.release?.(); state.phase = ""; state.entered = false; state.release = undefined; state.calls = []; state.scratch = "";
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function wav(duration = 3, rate = 24000, channels: 1 | 2 = 1, framesOverride?: number): Buffer {
  const frames = framesOverride ?? Math.round(duration * rate); const bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let sample = 0; sample < frames; sample++) {
    const t = sample / rate; const frequency = t < 0.7 ? 983 : t < 1.4 ? 1471 : 1973;
    const value = Math.round(5000 * Math.sin(2 * Math.PI * frequency * t));
    for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(value, 44 + (sample * channels + channel) * 2);
  }
  return bytes;
}

async function fixture(options: { sourceAudio?: boolean; music?: Buffer; musicVolume?: number; clipVolume?: number; fades?: number } = {}) {
  vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  vi.stubGlobal("fetch", state.fetch);
  const bytes = options.music ?? wav();
  const project = makeClipProject({ jobId: `music-${randomUUID()}`, name: "Synthetic stored project music", sourceFile: "source.mp4", sourceUrl: "",
    clipStart: 10, clipEnd: 14, sourceFrame: { width: 160, height: 90, fps: 10 } });
  Object.assign(project, { trimStart: 1, trimEnd: 3.5, compositionMode: "fit", captionsVisible: false,
    segments: [{ id: "first", start: 1, end: 2, kind: "speech", enabled: true }, { id: "second", start: 3, end: 3.5, kind: "speech", enabled: true }] });
  project.exportSettings = { ...project.exportSettings, width: 160, height: 90, fps: 10 };
  project.audio = { ...project.audio, musicSrc: `data:audio/wav;base64,${bytes.toString("base64")}`, musicName: "Synthetic fixture",
    clipVolume: options.clipVolume ?? 1, musicVolume: options.musicVolume ?? 0.5, fadeIn: options.fades ?? 0, fadeOut: options.fades ?? 0 };
  const source = dataPath("clips", "outputs", project.jobId, project.sourceFile); await mkdir(path.dirname(source), { recursive: true });
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=10:d=4",
    ...(options.sourceAudio === false ? ["-an"] : ["-f", "lavfi", "-i", "sine=frequency=431:sample_rate=48000:duration=4", "-c:a", "aac"]),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const job = { id: project.jobId, clips: [{ id: "clip", file: project.sourceFile, start: 10, end: 14 }] } as ClipJob;
  const jobsFile = dataPath("clips", "jobs.json"); await writeFile(jobsFile, JSON.stringify([job])); const jobsBefore = await readFile(jobsFile, "utf8");
  const record = { projectId: project.id, jobId: project.jobId, clipId: "clip", sourceFile: project.sourceFile, sourceSha256: sha(await readFile(source)) };
  const binding = { ownerId: "music-owner", records: [record] };
  const target = { projectId: project.id, jobId: project.jobId, clipId: "clip", revision: 1,
    digest: editorProjectDigest(project), renderSignature: editorRenderSignature(project) };
  const intent: EditorExportIntent = { requestId: randomUUID(), attemptId: randomUUID(), revision: 1,
    digest: target.digest, renderSignature: target.renderSignature, state: "claimed" };
  project.marketingEditor = { jobId: target.jobId, clipId: target.clipId, revision: target.revision, digest: target.digest,
    renderSignature: target.renderSignature, ownerId: binding.ownerId, exports: [intent], receipts: [] };
  const store = { read: async () => appDataSchema.parse({ ...emptyData, clipProjects: [project] }), readJob: async () => structuredClone(job),
    mutate: async (_id: string, update: (project: ClipProject) => ClipProject) => { Object.assign(project, update(structuredClone(project))); return structuredClone(project); } };
  const resolver = createStoredEditorMusicResolver({ binding, store });
  const asset = (await resolver.resolve(target))!; intent.musicAsset = preparationMusicAssetIdentity(asset);
  const workerOptions = { binding, store, musicAssets: resolver }; const worker = createEditorPreparationWorker(workerOptions); intent.workerEpoch = worker.getWorkerEpoch();
  const prepare = () => worker.prepare(project.id, intent.requestId, intent.attemptId!);
  const assertIsolated = async () => { expect(state.attach).not.toHaveBeenCalled(); expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled(); expect(await readFile(jobsFile, "utf8")).toBe(jobsBefore);
    await expect(stat(dataPath("publish-queue.json"))).rejects.toMatchObject({ code: "ENOENT" }); };
  return { bytes, project, source, target, intent, record, resolver, asset, worker, workerOptions, store, prepare, assertIsolated };
}

async function decode(file: string): Promise<Buffer> {
  const pcm = path.join(path.dirname(file), `decoded-${randomUUID()}.pcm`);
  await runFfmpeg(["-y", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", pcm]);
  return readFile(pcm);
}
function amplitude(pcm: Buffer, frequency: number, start: number, duration = 0.16): number {
  const length = Math.min(Math.floor(duration * 48000), pcm.length / 2 - Math.floor(start * 48000));
  let real = 0, imaginary = 0;
  for (let sample = 0; sample < length; sample++) {
    const value = pcm.readInt16LE((sample + Math.floor(start * 48000)) * 2) / 32768;
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * sample / Math.max(1, length - 1));
    const phase = 2 * Math.PI * frequency * sample / 48000;
    real += value * window * Math.cos(phase); imaginary += value * window * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) / Math.max(1, length);
}

it("renders stored music from output zero, continuously across cuts, through the exact original mixer", async () => {
  const f = await fixture(); state.calls = [];
  const proof = await f.prepare(); const calls = state.calls.filter((call) => call.args.includes(state.scratch));
  expect(calls).toHaveLength(1); const input = calls[0].args.indexOf(state.scratch);
  expect(calls[0].args.slice(input - 5, input)).toEqual(["-protocol_whitelist", "file", "-f", "wav", "-i"]);
  expect(calls[0].signal).toBeDefined(); expect(proof.musicAsset).toEqual(f.intent.musicAsset);
  expect(() => { proof.musicAsset!.sha256 = "f".repeat(64); }).toThrow();
  await expect(stat(state.scratch)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(path.dirname(proof.file))).toEqual(["prepared.mp4"]);
  expect(getExport(proof.exportId)).toBeUndefined(); await f.assertIsolated();
  const pcm = await decode(proof.file);
  for (const [start, expected] of [[0.1, 983], [0.85, 1471], [1.1, 1471]] as const) {
    const wanted = amplitude(pcm, expected, start); expect(wanted).toBeGreaterThan(0.001);
    expect(wanted).toBeGreaterThan(amplitude(pcm, expected === 983 ? 1471 : 983, start) * 8);
  }
  const legacy = startExport(editorPreparationSpec(f.project)); await vi.waitUntil(() => legacy.status !== "processing", { timeout: 15_000 });
  expect(legacy.status).toBe("done"); const legacyPcm = await decode(dataPath("clips", "outputs", f.project.jobId, legacy.file!));
  expect(sha(pcm)).toBe(sha(legacyPcm)); expect(state.attach).toHaveBeenCalledTimes(1); expect(state.enqueue).toHaveBeenCalledTimes(1);
  const evidence = path.join(process.cwd(), ".test-artifacts", "music-preparation"); await mkdir(evidence, { recursive: true });
  const artifact = path.join(evidence, "prepared-mix.mp4"); await copyFile(proof.file, artifact);
  await writeFile(path.join(evidence, "mix-timing.json"), JSON.stringify({ syntheticOnly: true, output: artifact,
    durationSec: proof.durationSec, artifactSha256: proof.artifactSha256, identicalLegacyDecodedAudio: true,
    tones: [0.1, 0.85, 1.1].map((start) => ({ start, source431: amplitude(pcm, 431, start), music983: amplitude(pcm, 983, start), music1471: amplitude(pcm, 1471, start) })) }, null, 2));
}, 30_000);

it("preserves relative music volume through mastering without applying clip fades to music", async () => {
  const low = await fixture({ musicVolume: 0.2 }); const lowPcm = await decode((await low.prepare()).file);
  const high = await fixture({ musicVolume: 0.8 }); const highPcm = await decode((await high.prepare()).file);
  const ratio = (pcm: Buffer) => amplitude(pcm, 983, 0.25) / amplitude(pcm, 431, 0.25);
  expect(ratio(highPcm)).toBeGreaterThan(ratio(lowPcm) * 2.5);
  const faded = await fixture({ clipVolume: 0, fades: 1 }); const fadedPcm = await decode((await faded.prepare()).file);
  const plain = await fixture({ clipVolume: 0, fades: 0 }); const plainPcm = await decode((await plain.prepare()).file);
  expect(sha(fadedPcm)).toBe(sha(plainPcm)); await plain.assertIsolated();
}, 30_000);

it.each([true, false])("does not loop short music with source audio=%s and preserves the original audio-length branch", async (sourceAudio) => {
  const f = await fixture({ sourceAudio, music: wav(0.4) }); const proof = await f.prepare(); const pcm = await decode(proof.file);
  expect(await probeDuration(proof.file)).toBeCloseTo(1.5, 1);
  if (sourceAudio) { expect(pcm.length / 2 / 48000).toBeGreaterThan(1.4); expect(amplitude(pcm, 983, 1.1)).toBeLessThan(amplitude(pcm, 431, 1.1) / 20); }
  else { expect(pcm.length / 2 / 48000).toBeGreaterThan(0.35); expect(pcm.length / 2 / 48000).toBeLessThan(0.6); }
  await f.assertIsolated();
}, 20_000);

it("verifies persisted music proof after reconstruction and rejects mutated, foreign and removed manifests", async () => {
  const f = await fixture(); const proof = await f.prepare();
  f.intent.state = "prepared"; f.intent.exportId = proof.exportId; f.intent.artifactSha256 = proof.artifactSha256;
  const reconstructed = createEditorPreparationWorker(f.workerOptions);
  const assetCalls = vi.spyOn(f.resolver, "resolve");
  const read = await reconstructed.readCurrentArtifact(f.project.id, f.intent.requestId); assetCalls.mockClear();
  expect(await reconstructed.readCurrentArtifact(f.project.id, f.intent.requestId)).toBe(read); expect(assetCalls).not.toHaveBeenCalled();
  read.assertCurrent(); expect(() => { read.musicAsset!.sourceRefSha256 = "e".repeat(64); }).toThrow();
  const other = createEditorPreparationWorker({ ...f.workerOptions, binding: { ...f.workerOptions.binding, ownerId: "foreign" } });
  await expect(other.readCurrentArtifact(f.project.id, f.intent.requestId)).rejects.toThrow("owner");
  f.intent.musicAsset = { ...f.intent.musicAsset!, sha256: "d".repeat(64) };
  await expect(reconstructed.readCurrentArtifact(f.project.id, f.intent.requestId)).rejects.toThrow("music bytes");
  f.intent.musicAsset = undefined; await expect(reconstructed.readCurrentArtifact(f.project.id, f.intent.requestId)).rejects.toThrow("music asset manifest");
  await f.assertIsolated();
}, 20_000);

it("binds the actual stored music manifest through original request, claim, rendering and locked prepared outcome", async () => {
  const f = await fixture(); f.project.marketingEditor = undefined;
  const editor = new MarketingEditor({ binding: f.workerOptions.binding, store: f.store, worker: f.worker, musicAssets: f.resolver });
  const owner = { ownerId: "music-owner", scopes: ["read", "write"] as ("read" | "write")[] };
  const principal = { ownerId: "music-owner", scopes: ["worker"] as "worker"[] };
  const snapshot = await editor.load(owner, f.project.id);
  const requestId = randomUUID();
  await editor.requestExport(owner, { operation: "request_editor_export", commandId: requestId, target: snapshot.target });
  const claim = await editor.claimExport(principal, { operation: "claim_editor_export", commandId: randomUUID(), target: snapshot.target, requestId });
  const stored = f.project.marketingEditor!.exports[0];
  expect(stored.musicAsset).toEqual(preparationMusicAssetIdentity(f.asset)); expect(stored.workerEpoch).toBe(f.worker.getWorkerEpoch());
  const proof = await f.worker.prepare(f.project.id, requestId, claim.attemptId!);
  const evidence = await f.worker.readPreparation(f.project, stored);
  expect(() => Object.assign(evidence!.musicAsset!, { sha256: "a".repeat(64) })).toThrow();
  const outcome = await editor.recordExportOutcome(principal, { operation: "record_editor_export_outcome", commandId: randomUUID(),
    target: snapshot.target, requestId, attemptId: claim.attemptId!, outcome: "prepared" });
  expect(outcome.receipt.state).toBe("prepared"); expect(f.project.marketingEditor!.exports[0].artifactSha256).toBe(proof.artifactSha256);
  const recovered = await createEditorPreparationWorker(f.workerOptions).readCurrentArtifact(f.project.id, requestId);
  expect(recovered.musicAsset).toEqual(stored.musicAsset); recovered.assertCurrent(); await f.assertIsolated();
}, 20_000);

it("renders existing stored image and music together while retaining both immutable input manifests", async () => {
  const f = await fixture(); const canvas = createCanvas(16, 16); const context = canvas.getContext("2d");
  context.fillStyle = "#ff0000"; context.fillRect(0, 0, 16, 16); const image = canvas.toBuffer("image/png");
  const fileName = `${createHash("sha1").update(image).digest("hex")}.png`;
  const imageFile = dataPath("overlay-images", fileName); await mkdir(path.dirname(imageFile), { recursive: true }); await writeFile(imageFile, image);
  f.project.overlays = [{ id: "stored-image", kind: "image", src: `/api/clips/overlay-images/${fileName}`, x: 0.25, y: 0.5,
    scale: 1, rotation: 0, opacity: 1, z: 0, locked: false, start: 0, end: 4 }];
  const digest = editorProjectDigest(f.project), renderSignature = editorRenderSignature(f.project);
  Object.assign(f.project.marketingEditor!, { digest, renderSignature }); Object.assign(f.intent, { digest, renderSignature });
  const overlays = createStoredEditorOverlayResolver({ binding: f.workerOptions.binding, store: f.store });
  const assets = await overlays.resolveMany({ ...f.target, digest, renderSignature }, ["stored-image"]);
  f.intent.overlayAssets = assets.map(({ overlayId, src, sha256, format, byteLength, width, height }) => ({ overlayId, src, sha256, format, byteLength, width, height }));
  const worker = createEditorPreparationWorker({ ...f.workerOptions, overlayAssets: overlays });
  const proof = await worker.prepare(f.project.id, f.intent.requestId, f.intent.attemptId!);
  expect(proof.musicAsset).toEqual(f.intent.musicAsset); expect(proof.overlayAssets).toEqual(f.intent.overlayAssets);
  expect(amplitude(await decode(proof.file), 983, 0.15)).toBeGreaterThan(0.001);
  const frame = path.join(path.dirname(proof.file), "mixed-frame.rgb");
  await runFfmpeg(["-y", "-i", proof.file, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", frame]);
  const pixels = await readFile(frame); let red = 0;
  for (let offset = 0; offset < pixels.length; offset += 3) if (pixels[offset] > 140 && pixels[offset + 1] < 70 && pixels[offset + 2] < 70) red++;
  expect(red).toBeGreaterThan(100); await f.assertIsolated();
  const artifact = path.join(process.cwd(), ".test-artifacts", "music-preparation", "prepared-image-music.mp4");
  await mkdir(path.dirname(artifact), { recursive: true }); await copyFile(proof.file, artifact);
}, 20_000);

it("refuses changed stored music before dispatch and after the real render before proof", async () => {
  const before = await fixture(); const changed = Buffer.from(before.bytes); changed[44] ^= 1;
  before.project.audio.musicSrc = `data:audio/wav;base64,${changed.toString("base64")}`;
  state.calls = []; await expect(before.prepare()).rejects.toThrow("changed"); expect(state.calls).toHaveLength(0);
  const after = await fixture(); state.phase = "after-render";
  const pending = after.prepare(); const outcome = pending.catch((error: unknown) => error);
  await vi.waitUntil(() => state.entered, { timeout: 10_000 }); after.project.audio.musicSrc = before.project.audio.musicSrc;
  state.release!(); expect(await outcome).toBeInstanceOf(Error); expect(await after.worker.readPreparation(after.project, after.intent)).toBeNull();
  await expect(stat(state.scratch)).rejects.toMatchObject({ code: "ENOENT" }); await after.assertIsolated();
}, 20_000);

it.each(["scratch-conflict", "scratch-change"] as const)("refuses %s without certifying output", async (phase) => {
  const f = await fixture(); state.phase = phase;
  await expect(f.prepare()).rejects.toThrow(phase === "scratch-conflict" ? /EEXIST/ : /scratch music input changed/);
  expect(await f.worker.readPreparation(f.project, f.intent)).toBeNull(); await expect(stat(state.scratch)).rejects.toMatchObject({ code: "ENOENT" });
  await f.assertIsolated();
}, 20_000);

it("rejects a wrong defensive byte copy, missing trusted manifest and unsupported source before any FFmpeg input", async () => {
  const f = await fixture(); const spec = editorPreparationSpec(f.project);
  const trusted = { ownerId: "music-owner", ...f.record, requestId: randomUUID(), attemptId: randomUUID(), projectDigest: f.target.digest,
    renderSignature: f.target.renderSignature, specSha256: preparationSpecDigest(spec), musicAsset: preparationMusicAssetIdentity(f.asset) };
  const changed = Buffer.from(f.bytes); changed[44] ^= 1;
  state.calls = [];
  await expect(prepareClipExport(trusted, async () => ({ binding: trusted, spec, musicAsset: { ...f.asset, copyBytes: () => changed } }))).rejects.toThrow("music copy");
  const missing = { ...trusted, attemptId: randomUUID(), musicAsset: undefined };
  await expect(prepareClipExport(missing, async () => ({ binding: missing, spec }))).rejects.toThrow("unverified existing music manifest");
  for (const musicSrc of ["https://example.invalid/music.wav", "file:///private.wav", "data:audio/mpeg;base64,SUQz", "data:audio/wav;base64,I0VYVE0zVQ=="]) {
    const unsupported = { ...f.project, audio: { ...f.project.audio, musicSrc }, marketingEditor: undefined };
    const target = { ...f.target, revision: 0, digest: editorProjectDigest(unsupported), renderSignature: editorRenderSignature(unsupported) };
    const resolver = createStoredEditorMusicResolver({ binding: f.workerOptions.binding, store: { read: async () => ({ clipProjects: [unsupported] }) } });
    await expect(resolver.resolve(target)).rejects.toMatchObject({ code: "unsupported" });
  }
  expect(state.calls).toHaveLength(0); await f.assertIsolated();
}, 20_000);

it("settles exact cancellation after rendering and removes scratch music before any proof can escape", async () => {
  const f = await fixture(); state.phase = "after-render"; const pending = f.prepare(); const outcome = pending.catch((error: unknown) => error);
  await vi.waitUntil(() => state.entered, { timeout: 10_000 });
  f.intent.state = "cancel_requested"; f.intent.cancellation = { commandId: randomUUID(), requestedAt: new Date().toISOString() };
  const stopping = f.worker.abortExact(f.project.id, f.intent.requestId, f.intent.attemptId!, f.intent.cancellation.commandId);
  await vi.waitUntil(() => state.calls.some((call) => call.signal?.aborted));
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toBeNull(); state.release!(); await stopping;
  expect(await outcome).toMatchObject({ name: "RenderCanceledError" }); expect(await f.worker.readPreparation(f.project, f.intent)).toBeNull();
  expect(await f.worker.readCancellationSettlement(f.project, f.intent)).toMatchObject({ settled: true });
  await expect(stat(state.scratch)).rejects.toMatchObject({ code: "ENOENT" }); await f.assertIsolated();
}, 20_000);

it("separately bounds an accepted 8MiB inline WAV while retaining the non-music 4M limit", async () => {
  const bytes = wav(1, 48000, 2, (8 * 1024 * 1024 - 44) / 4); const f = await fixture({ music: bytes });
  expect(f.project.audio.musicSrc!.length).toBeGreaterThan(4_000_000);
  const proof = await f.prepare(); expect(proof.musicAsset?.byteLength).toBe(8 * 1024 * 1024);
  expect(proof.specSha256).toBe(preparationSpecDigest(editorPreparationSpec(f.project))); await f.assertIsolated();
  const oversize = await fixture(); oversize.project.captions = [{ id: "huge", start: 1, end: 2, enabled: false, words: [], text: "x".repeat(4_000_001) }];
  const spec = editorPreparationSpec(oversize.project);
  const trusted = { ownerId: "music-owner", ...oversize.record, requestId: randomUUID(), attemptId: randomUUID(),
    projectDigest: editorProjectDigest(oversize.project), renderSignature: editorRenderSignature(oversize.project), specSha256: preparationSpecDigest(spec),
    musicAsset: preparationMusicAssetIdentity(oversize.asset) };
  state.calls = []; await expect(prepareClipExport(trusted, async () => ({ binding: trusted, spec, musicAsset: oversize.asset }))).rejects.toThrow("render spec changed");
  expect(state.calls).toHaveLength(0);
}, 30_000);
