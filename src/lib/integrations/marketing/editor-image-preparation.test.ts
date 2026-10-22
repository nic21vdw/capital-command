import { createHash, randomUUID } from "node:crypto";
import { readSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { dataPath } from "@/lib/paths";
import { emptyData } from "@/lib/mockData/seed";
import { appDataSchema, clipProjectSchema } from "@/lib/storage/schemas";
import { composeMarketingParity } from "./composition";
import { MarketingEditor, type EditorStore, type EditorSnapshot } from "./editor";
import { createEditorPreparationWorker } from "./editor-renderer";
import { createStoredEditorOverlayResolver } from "./editor-overlay-assets";
import { createExistingRecordReader } from "./records";
import type { Principal } from "./safety";
import type { ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";

const spies = vi.hoisted(() => ({ attach: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/clipping/jobs", async () => {
  const { dataPath } = await import("@/lib/paths");
  return { outputDir: (id: string) => dataPath("clips", "outputs", id), workDir: (id: string) => dataPath("clips", "uploads", id), attachEditedClipRender: spies.attach };
});
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: spies.enqueue }));
vi.mock("@/lib/clipping/ffmpeg", async (original) => {
  const actual = await original<typeof import("@/lib/clipping/ffmpeg")>();
  return { ...actual, runFfmpeg: vi.fn(actual.runFfmpeg) };
});
vi.mock("@napi-rs/canvas", async (original) => {
  const actual = await original<typeof import("@napi-rs/canvas")>();
  return { ...actual, loadImage: vi.fn(actual.loadImage) };
});
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, readSync: vi.fn(actual.readSync) };
});

const owner: Principal = { ownerId: "synthetic-image-owner", scopes: ["read", "write"] };
const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marketing-image-render-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Synthetic image fixture forbids network"); }));
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
type ImageMapping = { overlayId: string; mediaId: string; url: string };
type PublicSnapshot = Omit<EditorSnapshot, "media"> & { media: { source: { mediaId: string; url: string };
  overlays?: ImageMapping[]; edited?: { mediaId: string; url: string } } };

async function fixture(format: "png" | "jpeg" | "webp" = "png", images = true, duration = 1.4) {
  const canvas = createCanvas(32, 16);
  const context = canvas.getContext("2d"); context.fillStyle = "#ff0000"; context.fillRect(0, 0, 32, 16);
  const bytes = canvas.toBuffer(`image/${format}` as "image/png");
  const fileName = `${createHash("sha1").update(bytes).digest("hex")}.${format === "jpeg" ? "jpg" : format}`;
  const imageFile = dataPath("overlay-images", fileName);
  await mkdir(path.dirname(imageFile), { recursive: true }); await writeFile(imageFile, bytes);
  const project = clipProjectSchema.parse({ id: "image-project", jobId: "image-job", name: "Synthetic stored image",
    sourceFile: "source.mp4", sourceUrl: "", baseDurationSec: duration, baseWidth: 160, baseHeight: 90, clipStart: 10, clipEnd: 10 + duration,
    trimStart: 0, trimEnd: duration, compositionMode: "fit", captionsVisible: false,
    segments: [{ id: "keep-a", start: 0, end: 0.4, kind: "speech", enabled: true }, { id: "keep-b", start: 0.8, end: 1.2, kind: "speech", enabled: true }],
    overlays: images ? [{ id: "image-part-ambiguous", kind: "image", src: `/api/clips/overlay-images/${fileName}`,
      x: 0.25, y: 0.5, scale: 1, rotation: 0, opacity: 1, z: 0, start: 0.2, end: 1.0 }] : [],
    exportSettings: { width: 160, height: 90, fps: 10, filename: "synthetic-images" },
    createdAt: "2026-10-21T12:00:00.000Z", updatedAt: "2026-10-21T12:00:00.000Z" });
  let data = appDataSchema.parse({ ...emptyData, clipProjects: [project] });
  const job = { id: project.jobId, fileName: "Synthetic image source", sourceUrl: "", status: "queued", stage: "downloading", progress: 5,
    createdAt: project.createdAt, notices: [], clips: [{ id: "image-clip", start: 10, end: 10 + duration, file: project.sourceFile,
      score: 50, rationale: "Synthetic", breakdown: { hook: 50, pacing: 50, standalone: 50, intensity: 50 } }] } as ClipJob;
  const source = dataPath("clips", "outputs", project.jobId, project.sourceFile);
  await mkdir(path.dirname(source), { recursive: true });
  await runFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=navy:s=160x90:r=10:d=${duration}`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const jobsFile = dataPath("clips", "jobs.json");
  await writeFile(jobsFile, JSON.stringify([job]));
  const jobsBefore = await readFile(jobsFile, "utf8");
  const record = { projectId: project.id, jobId: project.jobId, clipId: "image-clip", sourceFile: project.sourceFile };
  const binding = { ownerId: owner.ownerId, records: [record] };
  let beforeMutate: (() => void) | undefined;
  const store: EditorStore = { read: async () => structuredClone(data), readJob: async () => structuredClone(job),
    mutate: async (id, update) => {
      beforeMutate?.(); beforeMutate = undefined;
      const index = data.clipProjects.findIndex((row) => row.id === id);
      const next = update(structuredClone(data.clipProjects[index]));
      data = appDataSchema.parse({ ...data, clipProjects: data.clipProjects.map((row, rowIndex) => rowIndex === index ? next : row) });
      return structuredClone(data.clipProjects[index]);
    } };
  const resolver = createStoredEditorOverlayResolver({ binding, store });
  const createWorker = () => createEditorPreparationWorker({ binding: { ...binding, records: [{ ...record,
    sourceSha256: sha(requireSourceBytes) }] }, store, overlayAssets: resolver });
  const requireSourceBytes = await readFile(source);
  const worker = createWorker();
  const editor = new MarketingEditor({ binding, store, worker, overlayAssets: resolver });
  const records = createExistingRecordReader({ resolveScope: (id) => id === owner.ownerId ? { ownerId: id,
    sourceIds: [], runIds: [], clipJobIds: [project.jobId], queueIds: [], accountIds: {} } : null });
  const base = { workspace: vi.fn(async () => ({})), execute: vi.fn() };
  const compose = (withResolver = true) => composeMarketingParity({ ownerId: owner.ownerId, base, records, editor,
    preparedEditorMedia: worker, ...(withResolver ? { overlayAssets: resolver } : {}) });
  const rawComposition = compose();
  const composed = { ...rawComposition, resources: rawComposition.resources as Required<typeof rawComposition.resources> };
  return { project, bytes, imageFile, fileName, source, resolver, worker, createWorker, editor, compose, composed,
    get current() { return data.clipProjects[0]; }, change: (update: (project: ClipProject) => void) => update(data.clipProjects[0]),
    beforeCommit: (callback: () => void) => { beforeMutate = callback; },
    async assertIsolated() {
      expect(await readFile(jobsFile, "utf8")).toBe(jobsBefore);
      expect(spies.attach).not.toHaveBeenCalled(); expect(spies.enqueue).not.toHaveBeenCalled();
      expect(await readdir(root)).not.toContain("publish-queue.json"); expect(fetch).not.toHaveBeenCalled();
    } };
}
async function requestAndClaim(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = await f.editor.load(owner, f.project.id);
  const request = await f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target });
  const requestId = request.receipt.requestId!;
  const claim = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: snapshot.target, requestId });
  const outcome = { operation: "record_editor_export_outcome" as const, commandId: randomUUID(), target: snapshot.target,
    requestId, attemptId: claim.attemptId, outcome: "prepared" as const };
  return { target: snapshot.target, requestId, attemptId: claim.attemptId, outcome };
}
async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  const claimed = await requestAndClaim(f);
  const proof = await f.worker.prepare(f.project.id, claimed.requestId, claimed.attemptId);
  await f.editor.recordExportOutcome(workerPrincipal, claimed.outcome);
  return { ...claimed, proof };
}
const mediaRequest = (method = "GET", range?: string) => new Request("http://127.0.0.1:3100/api/marketing/media/opaque", {
  method, headers: range ? { range } : {}
});
async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
  return await f.composed.resources.editor(owner, f.project.id) as PublicSnapshot;
}
async function frames(file: string) {
  const output = path.join(path.dirname(file), "decoded.rgb");
  await runFfmpeg(["-y", "-i", file, "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", output]);
  return readFile(output);
}
const pixel = (bytes: Buffer, frame: number, x: number, y: number) => [...bytes.subarray((frame * 160 * 90 + y * 160 + x) * 3, (frame * 160 * 90 + y * 160 + x) * 3 + 3)];

it.each(["png", "jpeg", "webp"] as const)("renders a verified stored %s at its kept timeline position with one image input and no publication", async (format) => {
  const f = await fixture(format);
  const visible = await snapshot(f);
  expect(visible.project.overlays[0].src).toBeUndefined();
  expect(visible.media.overlays).toHaveLength(1);
  expect(JSON.stringify(visible)).not.toContain(f.fileName);
  expect(JSON.stringify(visible)).not.toContain("/api/clips/overlay-images/");
  const result = await prepared(f);
  expect(result.proof.overlayAssets).toEqual(f.current.marketingEditor!.exports[0].overlayAssets);
  expect(result.proof.overlayAssets![0]).toMatchObject({ overlayId: f.project.overlays[0].id, sha256: sha(f.bytes), format });
  expect(Object.isFrozen(result.proof.overlayAssets)).toBe(true);
  expect(Reflect.set(result.proof.overlayAssets![0], "sha256", "0".repeat(64))).toBe(false);
  expect(Reflect.set(result.proof.overlayAssets!, "0", { sha256: "0".repeat(64) })).toBe(false);
  expect(f.current.overlays[0].src).toBe(f.project.overlays[0].src); // Never rewrite the original spec identity.
  const renderArgs = [...vi.mocked(runFfmpeg).mock.calls].reverse().find(([args]) => args.includes("-filter_complex"))![0];
  expect(renderArgs.filter((arg) => /[\\/]ov-\d+\.(?:png|jpg|webp)$/.test(arg))).toHaveLength(1);
  const decoded = await frames(result.proof.file);
  expect(pixel(decoded, 0, 40, 45)[0]).toBeLessThan(30);
  expect(pixel(decoded, 3, 40, 45)[0]).toBeGreaterThan(220);
  expect(pixel(decoded, 3, 130, 45)[0]).toBeLessThan(30);
  expect(pixel(decoded, 7, 40, 45)[0]).toBeLessThan(30);
  const artifact = await f.createWorker().readCurrentArtifact(f.project.id, result.requestId);
  expect(artifact.artifactSha256).toBe(result.proof.artifactSha256);
  expect(Object.isFrozen(artifact.overlayAssets)).toBe(true);
  expect(Reflect.set(artifact.overlayAssets![0], "sha256", "0".repeat(64))).toBe(false);
  expect(artifact.overlayAssets![0].sha256).toBe(sha(f.bytes));
  if (process.env.CLIP_IMAGE_EVIDENCE === "1") {
    const destination = path.join(process.cwd(), ".test-artifacts", "image-preparation");
    await mkdir(destination, { recursive: true });
    await copyFile(result.proof.file, path.join(destination, `stored-${format}.mp4`));
    await writeFile(path.join(destination, `stored-${format}.json`), JSON.stringify({ syntheticOnly: true, artifactSha256: result.proof.artifactSha256,
      manifest: result.proof.overlayAssets, framePixels: [0, 3, 7].map((frame) => ({ frame, center: pixel(decoded, frame, 40, 45) })),
      imageInputCount: 1, publicationAuthorized: false }, null, 2));
  }
  await f.assertIsolated();
}, 30_000);

it("keeps the no-asset baseline plain and rejects preview without a configured resolver", async () => {
  const plain = await fixture("png", false);
  const baseline = await prepared(plain);
  expect(pixel(await frames(baseline.proof.file), 3, 40, 45)[0]).toBeLessThan(30);
  const f = await fixture();
  await expect(f.compose(false).resources.editor!(owner, f.project.id)).rejects.toMatchObject({ status: 503 });
  await f.assertIsolated();
}, 30_000);

it("streams scoped raster GET/HEAD/ranges from metadata-only cache and denies foreign, stale, deleted and changed bytes", async () => {
  const f = await fixture();
  const visible = await snapshot(f); const mediaId = visible.media.overlays![0].mediaId;
  const first = await f.composed.resources.media(owner, mediaId, mediaRequest());
  expect(first.status).toBe(200); expect(Buffer.from(await first.arrayBuffer())).toEqual(f.bytes);
  vi.mocked(loadImage).mockClear(); vi.mocked(readSync).mockClear();
  const head = await f.composed.resources.media(owner, mediaId, mediaRequest("HEAD", "bytes=2-8"));
  expect(head.status).toBe(206); expect(head.headers.get("content-type")).toBe("image/png");
  expect(head.headers.get("cache-control")).toBe("private, no-store"); expect(await head.text()).toBe("");
  const range = await f.composed.resources.media(owner, mediaId, mediaRequest("GET", "bytes=2-8"));
  expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(f.bytes.subarray(2, 9));
  expect(loadImage).not.toHaveBeenCalled(); expect(readSync).not.toHaveBeenCalled();
  await expect(f.composed.resources.media({ ...owner, ownerId: "other-owner" }, mediaId, mediaRequest())).rejects.toMatchObject({ status: 403 });
  const before = statSync(f.imageFile); const changed = Buffer.from(f.bytes); changed[changed.length - 8] ^= 1;
  writeFileSync(f.imageFile, changed); utimesSync(f.imageFile, before.atime, before.mtime);
  expect((await f.composed.resources.media(owner, mediaId, mediaRequest("HEAD"))).status).toBe(404);
  await writeFile(f.imageFile, f.bytes);
  const loaded = await f.editor.load(owner, f.project.id);
  await f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: loaded.target, project: { ...loaded.project, name: "New revision" } });
  expect((await f.composed.resources.media(owner, mediaId, mediaRequest())).status).toBe(404);
  const current = await snapshot(f);
  await rm(f.imageFile);
  expect((await f.composed.resources.media(owner, current.media.overlays![0].mediaId, mediaRequest())).status).toBe(404);
  await f.assertIsolated();
}, 30_000);

it("retains exact stored refs on save and rejects raw/opaque substitutions, additions and kind changes before commit", async () => {
  const f = await fixture(); const visible = await snapshot(f);
  const save = (project: ClipProject) => f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: visible.target, project });
  for (const src of [f.project.overlays[0].src, visible.media.overlays![0].url, "/api/clips/overlay-images/" + "0".repeat(40) + ".png"]) {
    await expect(save({ ...visible.project, overlays: [{ ...visible.project.overlays[0], src }] })).rejects.toMatchObject({ code: "invalid" });
  }
  await expect(save({ ...visible.project, overlays: [...visible.project.overlays, { ...visible.project.overlays[0], id: "new-image" }] })).rejects.toMatchObject({ code: "invalid" });
  await expect(save({ ...visible.project, overlays: [{ ...visible.project.overlays[0], kind: "logo" }] })).rejects.toMatchObject({ code: "invalid" });
  expect(f.current.marketingEditor).toBeUndefined();
  const saved = await save({ ...visible.project, overlays: [{ ...visible.project.overlays[0], x: 0.75 }] });
  expect(saved.snapshot!.project.overlays[0].src).toBeUndefined(); expect(f.current.overlays[0].src).toBe(f.project.overlays[0].src);
  await f.assertIsolated();
}, 30_000);

it("denies mixed supported image and unsupported music without exposing or committing partial previews", async () => {
  const f = await fixture();
  f.change((project) => { project.audio.musicSrc = "C:\\synthetic-private\\music.wav"; });
  const internal = await f.editor.load(owner, f.project.id);
  expect(internal.requiresAssetConnection).toBe(true); expect(internal.project.audio.musicSrc).toBeUndefined();
  await expect(snapshot(f)).rejects.toMatchObject({ status: 503 });
  await expect(f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: internal.target })).rejects.toMatchObject({ code: "unavailable" });
  expect(f.current.marketingEditor).toBeUndefined(); await f.assertIsolated();
}, 30_000);

it("rechecks image bytes inside the original outcome lock and refuses stale request manifests", async () => {
  const f = await fixture(); const claimed = await requestAndClaim(f);
  const proof = await f.worker.prepare(f.project.id, claimed.requestId, claimed.attemptId);
  f.beforeCommit(() => { const changed = Buffer.from(f.bytes); changed[changed.length - 8] ^= 1; writeFileSync(f.imageFile, changed); });
  await expect(f.editor.recordExportOutcome(workerPrincipal, claimed.outcome)).rejects.toThrow();
  expect(f.current.marketingEditor!.exports[0].state).toBe("claimed"); expect(() => proof.assertCurrent()).toThrow();
  await f.assertIsolated();
}, 30_000);

it("binds persisted restart and streaming proofs to immutable asset hashes, project refs and owner", async () => {
  const f = await fixture(); const result = await prepared(f); const restarted = f.createWorker();
  await restarted.readCurrentArtifact(f.project.id, result.requestId);
  vi.mocked(loadImage).mockClear(); vi.mocked(readSync).mockClear(); vi.mocked(runFfmpeg).mockClear();
  (await restarted.readCurrentArtifact(f.project.id, result.requestId)).assertCurrent();
  expect(loadImage).not.toHaveBeenCalled(); expect(readSync).not.toHaveBeenCalled(); expect(runFfmpeg).not.toHaveBeenCalled();
  f.change((project) => { project.marketingEditor!.exports[0].overlayAssets![0].sha256 = "0".repeat(64); });
  await expect(restarted.readCurrentArtifact(f.project.id, result.requestId)).rejects.toThrow();
  await expect(f.createWorker().readCurrentArtifact(f.project.id, result.requestId)).rejects.toThrow();
  f.change((project) => { project.marketingEditor!.exports[0].overlayAssets![0].sha256 = sha(f.bytes); project.marketingEditor!.ownerId = "revoked"; });
  await expect(restarted.readCurrentArtifact(f.project.id, result.requestId)).rejects.toThrow();
  await f.assertIsolated();
}, 30_000);

it("does not redirect a cached image grant when the configured data root changes", async () => {
  const f = await fixture(); const visible = await snapshot(f); const mediaId = visible.media.overlays![0].mediaId;
  await (await f.composed.resources.media(owner, mediaId, mediaRequest())).arrayBuffer();
  const otherRoot = await mkdtemp(path.join(tmpdir(), "marketing-image-other-"));
  await mkdir(path.join(otherRoot, "overlay-images")); await writeFile(path.join(otherRoot, "overlay-images", f.fileName), "unverified root bytes");
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", otherRoot);
  expect((await f.composed.resources.media(owner, mediaId, mediaRequest())).status).toBe(404);
}, 30_000);

it("rejects changed asset bytes after a verified prepared stream and denies deleted-project image/video grants", async () => {
  const f = await fixture(); const result = await prepared(f); const visible = await snapshot(f);
  const restarted = f.createWorker(); await restarted.readCurrentArtifact(f.project.id, result.requestId);
  const originalStat = statSync(f.imageFile); const changed = Buffer.from(f.bytes); changed[changed.length - 8] ^= 1;
  writeFileSync(f.imageFile, changed); utimesSync(f.imageFile, originalStat.atime, originalStat.mtime);
  await expect(restarted.readCurrentArtifact(f.project.id, result.requestId)).rejects.toThrow();
  await expect(f.createWorker().readCurrentArtifact(f.project.id, result.requestId)).rejects.toThrow();
  await writeFile(f.imageFile, f.bytes);
  const loaded = await f.editor.load(owner, f.project.id);
  await f.editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: loaded.target });
  expect((await f.composed.resources.media(owner, visible.media.overlays![0].mediaId, mediaRequest())).status).toBe(404);
  expect((await f.composed.resources.media(owner, visible.media.edited!.mediaId, mediaRequest())).status).toBe(404);
  await expect(restarted.readCurrentArtifact(f.project.id, result.requestId)).rejects.toThrow();
  await f.assertIsolated();
}, 30_000);

it("checks the approved image bytes again before claiming a request", async () => {
  const f = await fixture(); const loaded = await f.editor.load(owner, f.project.id);
  const requested = await f.editor.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: loaded.target });
  await writeFile(f.imageFile, Buffer.alloc(f.bytes.length));
  await expect(f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: loaded.target,
    requestId: requested.receipt.requestId! })).rejects.toThrow();
  expect(f.current.marketingEditor!.exports[0].state).toBe("pending_dispatch"); await f.assertIsolated();
}, 30_000);

it("rejects text-to-image conversion even when the existing ID has no source", async () => {
  const f = await fixture("png", false);
  f.change((project) => { project.overlays = [{ id: "text", kind: "text", text: "Original text", x: 0.5, y: 0.5,
    scale: 1, rotation: 0, opacity: 1, z: 0, locked: false, start: 0, end: 1.4 }]; });
  const loaded = await f.editor.load(owner, f.project.id);
  await expect(f.editor.save(owner, { operation: "save_editor_project", commandId: randomUUID(), target: loaded.target,
    project: { ...loaded.project, overlays: [{ ...loaded.project.overlays[0], kind: "image" }] } })).rejects.toMatchObject({ code: "invalid" });
  expect(f.current.marketingEditor).toBeUndefined(); await f.assertIsolated();
}, 30_000);

it.each(["interval", "command"] as const)("refuses pathological prepared image %s fanout before starting a render", async (budget) => {
  const f = await fixture("png", true, 120);
  f.change((project) => {
    project.segments = Array.from({ length: budget === "interval" ? 513 : 512 }, (_, index) => ({ id: `keep-${index}`,
      start: index * 0.2, end: index * 0.2 + 0.1, enabled: true, kind: "speech" }));
    const image = { ...project.overlays[0], start: 0, end: 120 };
    project.overlays = [{ ...image, id: "image-with-many-kept-intervals" }];
  });
  const claimed = await requestAndClaim(f); vi.mocked(runFfmpeg).mockClear();
  await expect(f.worker.prepare(f.project.id, claimed.requestId, claimed.attemptId)).rejects.toThrow(budget === "interval" ? "too many active intervals" : "bounded render command size");
  expect(vi.mocked(runFfmpeg).mock.calls.every(([args]) => !args.includes("-filter_complex"))).toBe(true);
  expect(f.current.marketingEditor!.exports[0].state).toBe("claimed"); await f.assertIsolated();
}, 30_000);
