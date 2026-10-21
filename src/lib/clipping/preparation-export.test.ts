import { createHash, randomUUID } from "node:crypto";
import { readSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { makeClipProject } from "@/lib/clipping/editor";
import { hasAudioStream, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { renderSignature } from "@/lib/clipping/export-signature";
import { getExport, prepareClipExport, preparationSpecDigest, startExport, type PreparationExportBinding } from "@/lib/clipping/export";
import { createEditorPreparationWorker, editorPreparationSpec } from "@/lib/integrations/marketing/editor-renderer";
import type { ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";

const spies = vi.hoisted(() => ({ attach: vi.fn(async () => undefined), enqueue: vi.fn(async () => undefined) }));
vi.mock("@/lib/clipping/jobs", async () => {
  const { dataPath } = await import("@/lib/paths");
  return { outputDir: (id: string) => dataPath("clips", "outputs", id),
    workDir: (id: string) => dataPath("clips", "uploads", id), attachEditedClipRender: spies.attach };
});
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: spies.enqueue }));
vi.mock("@/lib/clipping/ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clipping/ffmpeg")>();
  return { ...actual, runFfmpeg: vi.fn(actual.runFfmpeg) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readSync: vi.fn(actual.readSync) };
});

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(",")}}`;
};
const projectDigest = (value: ClipProject): string => sha(canonical(Object.fromEntries(Object.entries(value)
  .filter(([key]) => !["marketingEditor", "updatedAt", "renderSignature", "captionCount", "captionsOmitted"].includes(key)))));
let project: ClipProject;
let source: string;
let binding: PreparationExportBinding;
const spec = () => editorPreparationSpec(project);
const current = async () => ({ binding: structuredClone(binding), spec: spec() });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  const jobId = `synthetic-${randomUUID()}`;
  project = makeClipProject({ jobId, name: "Synthetic preparation only", sourceFile: "source.mp4",
    sourceUrl: "", clipStart: 10, clipEnd: 11.6, sourceFrame: { width: 160, height: 90, fps: 10 } });
  project = { ...project, trimStart: 0.2, trimEnd: 1.2, compositionMode: "fit",
    captions: [{ id: "caption", start: 0.2, end: 1.2, text: "PREPARATION ONLY", enabled: true, words: [] }],
    exportSettings: { ...project.exportSettings, width: 160, height: 160, fps: 10, filename: "synthetic-proof" } };
  source = dataPath("clips", "outputs", jobId, project.sourceFile);
  await mkdir(path.dirname(source), { recursive: true });
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=10:d=1.6",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.6", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
  binding = { ownerId: "synthetic-owner", projectId: project.id, jobId, clipId: "original-clip",
    sourceFile: project.sourceFile, sourceSha256: sha(await readFile(source)), projectDigest: projectDigest(project),
    specSha256: preparationSpecDigest(spec()), renderSignature: renderSignature(spec()), requestId: randomUUID(), attemptId: randomUUID() };
}, 30_000);
afterEach(() => vi.unstubAllEnvs());

describe("original editor preparation-only export", () => {
  it("preserves the default real-render attach and auto-enqueue path exactly once", async () => {
    const record = startExport(spec());
    await vi.waitUntil(() => record.status !== "processing", { timeout: 30_000, interval: 20 });
    expect(record.error).toBeUndefined();
    expect(record.status).toBe("done");
    expect(record.progress).toBe(100);
    expect(spies.attach).toHaveBeenCalledExactlyOnceWith(project.jobId, project.sourceFile, record.file, renderSignature(spec()));
    expect(spies.enqueue).toHaveBeenCalledExactlyOnceWith({ jobId: project.jobId,
      exportPath: dataPath("clips", "outputs", project.jobId, record.file!), spokenText: "PREPARATION ONLY" });
    expect(await probeDuration(dataPath("clips", "outputs", project.jobId, record.file!))).toBeCloseTo(1, 1);
  }, 30_000);

  it("renders real trimmed captioned audio/video without attachment or enqueue, even with publishing enabled", async () => {
    const progress: number[] = [];
    vi.mocked(runFfmpeg).mockClear();
    const proof = await prepareClipExport(binding, current, { onProgress: (value) => progress.push(value) });
    expect(vi.mocked(runFfmpeg).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(vi.mocked(runFfmpeg).mock.calls.every(([args]) => args[0] === "-protocol_whitelist" && args[1] === "file")).toBe(true);
    expect(proof.artifactSha256).toBe(sha(await readFile(proof.file)));
    expect(proof.durationSec).toBeCloseTo(1, 1);
    expect(proof.renderSignature).toBe(binding.renderSignature);
    expect(proof.projectDigest).toBe(binding.projectDigest);
    expect(await hasAudioStream(proof.file)).toBe(true);
    expect(progress.at(-1)).toBe(100);
    expect(progress.slice(0, -1).every((value) => value > 0 && value < 100)).toBe(true);
    expect(getExport(proof.exportId)).toBeUndefined();
    expect(spies.attach).not.toHaveBeenCalled();
    expect(spies.enqueue).not.toHaveBeenCalled();
    expect((await readdir(path.dirname(proof.file))).sort()).toEqual(["prepared.mp4"]);
    await expect(proof.verifyCurrent()).resolves.toBeUndefined();
    // A real decoded frame proves the ASS captions change rendered pixels.
    const plain = structuredClone(project); plain.captionsVisible = false;
    const plainSpec = editorPreparationSpec(plain);
    const plainBinding = { ...binding, attemptId: randomUUID(), specSha256: preparationSpecDigest(plainSpec),
      renderSignature: renderSignature(plainSpec) };
    const plainProof = await prepareClipExport(plainBinding, async () => ({ binding: plainBinding, spec: plainSpec }));
    const frameHash = async (file: string) => (await runFfmpeg(["-i", file, "-frames:v", "1", "-an", "-f", "md5", "-"])).stdout;
    expect(await frameHash(proof.file)).not.toBe(await frameHash(plainProof.file));
    if (process.env.CLIP_PREPARATION_EVIDENCE === "1") {
      const evidenceDir = path.join(process.cwd(), ".test-artifacts", "preparation");
      await mkdir(evidenceDir, { recursive: true });
      await copyFile(proof.file, path.join(evidenceDir, "prepared.mp4"));
      await copyFile(source, path.join(evidenceDir, "source.mp4"));
      await writeFile(path.join(evidenceDir, "receipt.json"), JSON.stringify({ ...proof, progress,
        sourceFile: "source.mp4", file: "prepared.mp4", attached: false, enqueued: false,
        captionFrameDiffers: true, publishingFlagsEnabled: true, syntheticOnly: true }, null, 2));
    }
  }, 30_000);

  it("rejects mismatched output bytes when independent proof is read or committed", async () => {
    const proof = await prepareClipExport(binding, current);
    await writeFile(proof.file, Buffer.alloc(proof.bytes, 7));
    await expect(proof.verifyCurrent()).rejects.toThrow("verified preparation media changed");
    expect(() => proof.assertCurrent()).toThrow("verified preparation media changed");
    expect(spies.enqueue).not.toHaveBeenCalled();
  }, 30_000);

  it("honors Burn captions off in both export paths while retaining positioned text overlays", async () => {
    project.exportSettings.burnCaptions = false;
    project.overlays = [{ id: "text", kind: "text", text: "KEEP OVERLAY", x: 0.5, y: 0.25,
      scale: 1, rotation: 0, opacity: 1, z: 1, locked: false, start: 0.2, end: 1.2, color: "#ffffff" }];
    binding = { ...binding, projectDigest: projectDigest(project), specSha256: preparationSpecDigest(spec()),
      renderSignature: renderSignature(spec()) };
    const prepared = await prepareClipExport(binding, current);
    const hidden = { ...project, captionsVisible: false };
    const hiddenSpec = editorPreparationSpec(hidden);
    const hiddenBinding = { ...binding, attemptId: randomUUID(), projectDigest: projectDigest(hidden),
      specSha256: preparationSpecDigest(hiddenSpec), renderSignature: renderSignature(hiddenSpec) };
    const reference = await prepareClipExport(hiddenBinding, async () => ({ binding: hiddenBinding, spec: hiddenSpec }));
    const original = startExport(spec());
    await vi.waitUntil(() => original.status !== "processing", { timeout: 30_000, interval: 20 });
    expect(original.status).toBe("done");
    const frameHash = async (file: string) => (await runFfmpeg(["-i", file, "-frames:v", "1", "-an", "-f", "md5", "-"])).stdout;
    const expected = await frameHash(reference.file);
    expect(await frameHash(prepared.file)).toBe(expected);
    expect(await frameHash(dataPath("clips", "outputs", project.jobId, original.file!))).toBe(expected);
    const blankSpec = { ...hiddenSpec, overlays: [] };
    const blankBinding = { ...hiddenBinding, attemptId: randomUUID(), specSha256: preparationSpecDigest(blankSpec),
      renderSignature: renderSignature(blankSpec) };
    const blank = await prepareClipExport(blankBinding, async () => ({ binding: blankBinding, spec: blankSpec }));
    expect(await frameHash(blank.file)).not.toBe(expected);
  }, 30_000);

  it("rejects source or canonical spec changes before rendering", async () => {
    await expect(prepareClipExport({ ...binding, sourceSha256: "0".repeat(64) },
      async () => ({ binding: { ...binding, sourceSha256: "0".repeat(64) }, spec: spec() }))).rejects.toThrow("source bytes changed");
    project.trimEnd = 1;
    await expect(prepareClipExport(binding, current)).rejects.toThrow("render spec changed");
    expect(spies.attach).not.toHaveBeenCalled();
  });

  it("keeps the correct source frames across multiple cuts in both real render paths", async () => {
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=1.6,geq=lum='16+N*10':cb=128:cr=128",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.6", "-c:v", "libx264", "-crf", "0",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
    project = { ...project, captionsVisible: false, trimStart: 0, trimEnd: 0.6,
      exportSettings: { ...project.exportSettings, width: 160, height: 90 }, segments: [
        { id: "first", start: 0, end: 0.2, kind: "speech", enabled: true },
        { id: "cut", start: 0.2, end: 0.4, kind: "silence", enabled: false },
        { id: "last", start: 0.4, end: 0.6, kind: "speech", enabled: true }
      ] };
    binding = { ...binding, sourceSha256: sha(await readFile(source)), projectDigest: projectDigest(project),
      specSha256: preparationSpecDigest(spec()), renderSignature: renderSignature(spec()) };
    const prepared = await prepareClipExport(binding, current);
    const original = startExport(spec());
    await vi.waitUntil(() => original.status !== "processing", { timeout: 30_000, interval: 20 });
    expect(original.status).toBe("done");
    const levels = async (file: string, name: string): Promise<number[]> => {
      const decoded = path.join(path.dirname(source), `${name}.gray`);
      await runFfmpeg(["-y", "-i", file, "-an", "-f", "rawvideo", "-pix_fmt", "gray", decoded]);
      const bytes = await readFile(decoded);
      const values = [];
      for (let offset = 0; offset < bytes.length; offset += 160 * 90) {
        const frame = bytes.subarray(offset, offset + 160 * 90);
        values.push(frame.reduce((sum, value) => sum + value, 0) / frame.length);
      }
      return values;
    };
    const input = await levels(source, "source-frames");
    const nearest = (values: number[]) => values.map((value) => input.reduce((best, candidate, index) =>
      Math.abs(candidate - value) < Math.abs(input[best] - value) ? index : best, 0));
    expect(nearest(await levels(prepared.file, "prepared-frames"))).toEqual([0, 1, 4, 5]);
    expect(nearest(await levels(dataPath("clips", "outputs", project.jobId, original.file!), "original-frames"))).toEqual([0, 1, 4, 5]);
  }, 30_000);

  it("rejects changed source bytes after rendering and blocks disguised remote playlists", async () => {
    const proof = await prepareClipExport(binding, current);
    await writeFile(source, "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.6,\nhttps://example.invalid/remote.ts\n#EXT-X-ENDLIST\n");
    expect(() => proof.assertCurrent()).toThrow("verified preparation media changed");
    binding = { ...binding, attemptId: randomUUID(), sourceSha256: sha(await readFile(source)) };
    await expect(prepareClipExport(binding, current)).rejects.toThrow("not a supported local video container");
    expect(spies.enqueue).not.toHaveBeenCalled();
  }, 30_000);

  it("rechecks current source/spec after FFmpeg, refusing a render whose revision changed", async () => {
    await expect(prepareClipExport(binding, current, { onProgress: (value) => {
      if (value < 100) project.captions[0].text = "CHANGED WHILE RENDERING";
    } })).rejects.toThrow("render spec changed");
    expect(spies.enqueue).not.toHaveBeenCalled();
  }, 30_000);

  it.each(["music", "image", "sfx", "filename"])("fails closed for unsupported %s assets/settings", async (kind) => {
    if (kind === "music") project.audio.musicSrc = "https://example.invalid/secret.audio";
    if (kind === "image") project.overlays = [{ id: "image", kind: "image", src: "data:image/png;base64,AA==", x: 0.5, y: 0.5,
      scale: 1, rotation: 0, opacity: 1, z: 0, locked: false, start: 0, end: 1 }];
    if (kind === "sfx") project.sfx = { ...project.sfx!, enabled: true };
    if (kind === "filename") project.exportSettings.filename = "../escape";
    binding = { ...binding, specSha256: preparationSpecDigest(spec()), renderSignature: renderSignature(spec()) };
    await expect(prepareClipExport(binding, current)).rejects.toThrow(/unsupported/);
    expect(spies.enqueue).not.toHaveBeenCalled();
  });

  it("rejects escaped source identities and symlink/junction ancestors", async () => {
    await expect(prepareClipExport({ ...binding, sourceFile: "../source.mp4" }, current)).rejects.toThrow("trusted preparation binding");
    const real = path.join(path.dirname(source), "actual");
    await mkdir(real);
    await writeFile(path.join(real, "source.mp4"), await readFile(source));
    await rm(source);
    // AppContainer Windows denies new junctions; its existing dependency
    // junction still gives us a real ancestor to prove is rejected before I/O.
    const linked = dataPath("clips", "outputs", `${project.jobId}-link`);
    try {
      await symlink(real, linked, "junction");
      project.jobId = `${project.jobId}-link`;
      binding = { ...binding, jobId: project.jobId, specSha256: preparationSpecDigest(spec()), renderSignature: renderSignature(spec()) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      const dependencyJunction = path.join(process.cwd(), "node_modules");
      expect((await lstat(dependencyJunction)).isSymbolicLink()).toBe(true);
      vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", path.join(dependencyJunction, "unused-preparation-test-root"));
    }
    await expect(prepareClipExport(binding, current)).rejects.toThrow("symlinks or junctions");
  });

  it("never overwrites an already completed or uncertain attempt directory", async () => {
    const proof = await prepareClipExport(binding, current);
    await expect(prepareClipExport(binding, current)).rejects.toMatchObject({ code: "EEXIST" });
    expect(sha(await readFile(proof.file))).toBe(proof.artifactSha256);
  }, 30_000);
});

it("bridges independent proof to EditorWorkerPorts and rejects a stale original project", async () => {
  const digest = projectDigest(project);
  const intent: { requestId: string; attemptId: string; revision: number; digest: string; renderSignature: string;
    workerEpoch?: string; state: "claimed" | "prepared"; exportId?: string; artifactSha256?: string } = {
    requestId: binding.requestId, attemptId: binding.attemptId, revision: 1, digest,
    renderSignature: binding.renderSignature, state: "claimed" };
  const managed = { ...project, marketingEditor: { ownerId: binding.ownerId, jobId: project.jobId, clipId: binding.clipId,
    revision: 1, digest, renderSignature: binding.renderSignature, receipts: [], exports: [intent] } };
  const job = { id: project.jobId, clips: [{ id: binding.clipId, start: project.clipStart, end: project.clipEnd, file: project.sourceFile }] } as ClipJob;
  const options = { binding: { ownerId: binding.ownerId, records: [{ projectId: project.id,
    jobId: project.jobId, clipId: binding.clipId, sourceFile: project.sourceFile, sourceSha256: binding.sourceSha256 }] },
    store: { read: async () => ({ clipProjects: [managed] }), readJob: async () => job } };
  const worker = createEditorPreparationWorker(options);
  intent.workerEpoch = worker.getWorkerEpoch();
  worker.assertPreparationOnly();
  expect(await worker.readPreparation(managed, intent)).toBeNull();
  const artifact = await worker.prepare(project.id, intent.requestId, binding.attemptId);
  const evidence = await worker.readPreparation(managed, intent);
  expect(evidence).toMatchObject({ requestId: intent.requestId, attemptId: binding.attemptId, digest,
    artifactSha256: artifact.artifactSha256, renderSignature: binding.renderSignature });
  vi.mocked(readSync).mockClear();
  evidence!.assertCurrent();
  expect(vi.mocked(readSync).mock.calls.length).toBeGreaterThan(0); // Commit proof remains a full byte hash.
  await expect(worker.readArtifact(project.id, intent.requestId, intent.attemptId)).rejects.toThrow("claimed attempt changed");
  intent.state = "prepared"; intent.exportId = artifact.exportId; intent.artifactSha256 = artifact.artifactSha256;
  const restartedWorker = createEditorPreparationWorker(options);
  const media = await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  expect(media.file).toBe(artifact.file);
  expect(media.attemptId).toBe(intent.attemptId);
  expect(media.artifactSha256).toBe(artifact.artifactSha256);
  media.assertCurrent();
  vi.mocked(readSync).mockClear();
  vi.mocked(runFfmpeg).mockClear();
  const cached = await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  cached.assertCurrent(); // The media adapter repeats this after descriptor open.
  expect(cached).toBe(media);
  expect(vi.mocked(readSync)).not.toHaveBeenCalled();
  expect(vi.mocked(runFfmpeg)).not.toHaveBeenCalled();
  expect(cached).not.toHaveProperty("verifyCurrent");
  expect(cached).not.toHaveProperty("streamingRead");
  await expect(restartedWorker.readCurrentArtifact("foreign-project", intent.requestId)).rejects.toThrow("trusted render allowlist");
  const foreignOwner = createEditorPreparationWorker({ ...options, binding: { ...options.binding, ownerId: "foreign-owner" } });
  await expect(foreignOwner.readCurrentArtifact(project.id, intent.requestId)).rejects.toThrow("not prepared for this owner");
  intent.artifactSha256 = "0".repeat(64);
  await expect(restartedWorker.readArtifact(project.id, intent.requestId, intent.attemptId)).rejects.toThrow("artifact bytes changed");
  intent.artifactSha256 = artifact.artifactSha256;
  await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  const outputBytes = await readFile(artifact.file);
  const outputStat = await stat(artifact.file);
  const changedOutput = Buffer.from(outputBytes); changedOutput[Math.floor(changedOutput.length / 2)] ^= 1;
  await writeFile(artifact.file, changedOutput);
  await utimes(artifact.file, outputStat.atimeMs / 1000, outputStat.mtimeMs / 1000);
  vi.mocked(readSync).mockClear();
  await expect(restartedWorker.readCurrentArtifact(project.id, intent.requestId)).rejects.toThrow(/artifact bytes changed|media changed/);
  expect(vi.mocked(readSync).mock.calls.length).toBeGreaterThan(0); // Changed stats force independent hashing.
  await writeFile(artifact.file, outputBytes);
  await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  const sourceBytes = await readFile(source);
  const sourceStat = await stat(source);
  const changedSource = Buffer.from(sourceBytes); changedSource[Math.floor(changedSource.length / 2)] ^= 1;
  await writeFile(source, changedSource);
  await utimes(source, sourceStat.atimeMs / 1000, sourceStat.mtimeMs / 1000);
  await expect(restartedWorker.readCurrentArtifact(project.id, intent.requestId)).rejects.toThrow("source bytes changed");
  await writeFile(source, sourceBytes);
  await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  await rm(artifact.file);
  await expect(restartedWorker.readCurrentArtifact(project.id, intent.requestId)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(artifact.file, outputBytes);
  await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  managed.marketingEditor.ownerId = "revoked-owner";
  await expect(restartedWorker.readCurrentArtifact(project.id, intent.requestId)).rejects.toThrow("not prepared for this owner");
  managed.marketingEditor.ownerId = binding.ownerId;
  await restartedWorker.readCurrentArtifact(project.id, intent.requestId);
  managed.trimEnd = 1;
  await expect(restartedWorker.readCurrentArtifact(project.id, intent.requestId)).rejects.toThrow("revision or claimed attempt changed");
  await expect(worker.readPreparation(managed, intent)).rejects.toThrow("revision or claimed attempt changed");
  expect(spies.attach).not.toHaveBeenCalled();
  expect(spies.enqueue).not.toHaveBeenCalled();
}, 30_000);
