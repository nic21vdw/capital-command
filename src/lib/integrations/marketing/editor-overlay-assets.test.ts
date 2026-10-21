import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, truncate, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appDataSchema, clipProjectSchema } from "@/lib/storage/schemas";
import { emptyData } from "@/lib/mockData/seed";
import type { ClipProject } from "@/types/domain";
import { editorProjectDigest, editorRenderSignature } from "./editor-state";
import type { EditorTarget } from "./editor-types";
import { createStoredEditorOverlayResolver, STORED_EDITOR_OVERLAY_LIMITS } from "./editor-overlay-assets";

vi.mock("@napi-rs/canvas", async (original) => {
  const canvas = await original<typeof import("@napi-rs/canvas")>();
  return { ...canvas, loadImage: vi.fn(canvas.loadImage) };
});
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, lstatSync: vi.fn(fs.lstatSync), openSync: vi.fn(fs.openSync), readSync: vi.fn(fs.readSync) };
});

let root: string;
let readExistingAppData: typeof import("@/lib/storage/store")["readExistingAppData"];
const binding = { ownerId: "overlay-owner", records: [{ projectId: "project-1", jobId: "job-1", clipId: "clip-1", sourceFile: "master.mp4" }] };
const sha1 = (bytes: Buffer) => createHash("sha1").update(bytes).digest("hex");
const document = () => path.join(root, "capital-command.json");
const images = () => path.join(root, "overlay-images");
const store = { read: () => readExistingAppData() };
const resolver = () => createStoredEditorOverlayResolver({ binding, store });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "editor-overlay-proof-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.resetModules();
  ({ readExistingAppData } = await import("@/lib/storage/store"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in synthetic overlay fixtures."); }));
  vi.mocked(loadImage).mockClear();
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(fs.lstatSync).mockImplementation(actual.lstatSync).mockClear();
  vi.mocked(fs.openSync).mockImplementation(actual.openSync).mockClear();
  vi.mocked(fs.readSync).mockImplementation(actual.readSync).mockClear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("editor-overlay-proof-")) throw new Error("Invalid fixture cleanup root.");
  await rm(root, { recursive: true, force: true });
});
function raster(extension = "png", color = "#f02040"): Buffer {
  const canvas = createCanvas(4, 3);
  canvas.getContext("2d").fillStyle = color;
  canvas.getContext("2d").fillRect(0, 0, 4, 3);
  return extension === "jpg" ? canvas.toBuffer("image/jpeg")
    : extension === "webp" ? canvas.toBuffer("image/webp") : canvas.toBuffer("image/png");
}
async function fixture(bytes = raster(), extension = "png", srcOverride?: string) {
  const fileName = `${sha1(bytes)}.${extension}`;
  const src = srcOverride ?? `/api/clips/overlay-images/${fileName}`;
  const project = clipProjectSchema.parse({
    id: "project-1", name: "Synthetic original overlay project", jobId: "job-1", sourceFile: "master.mp4",
    baseDurationSec: 10, clipStart: 20, clipEnd: 30, trimStart: 0, trimEnd: 10,
    overlays: [{ id: "overlay-1", kind: "watermark", src, x: 0.5, y: 0.5, scale: 1, rotation: 0,
      opacity: 1, z: 0, locked: false, start: 0, end: 10 }],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z"
  });
  const target: EditorTarget = { projectId: project.id, jobId: project.jobId, clipId: "clip-1", revision: 3,
    digest: editorProjectDigest(project), renderSignature: editorRenderSignature(project) };
  project.marketingEditor = { ownerId: binding.ownerId, jobId: project.jobId, clipId: "clip-1", revision: target.revision,
    digest: target.digest, renderSignature: target.renderSignature, receipts: [], exports: [] };
  await mkdir(images());
  const file = path.join(images(), fileName);
  await writeFile(file, bytes);
  await writeFile(document(), JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project] })));
  return { project, target, bytes, file, src };
}
async function editProject(update: (project: ClipProject) => ClipProject) {
  const data = JSON.parse(await readFile(document(), "utf8"));
  data.clipProjects = data.clipProjects.map(update);
  await writeFile(document(), JSON.stringify(data));
}
function chunk(kind: string, payload: Buffer): Buffer {
  const bytes = Buffer.alloc(12 + payload.length);
  bytes.writeUInt32BE(payload.length); bytes.write(kind, 4); payload.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}
function png(width = 4, height = 3, interlace = false, decodedOverride?: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; header[12] = interlace ? 1 : 0;
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const parts: Buffer[] = [];
  if (!decodedOverride) for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    if (w && h) for (let row = 0; row < h; row++) {
      const pixels = Buffer.alloc(1 + 4 * w, 0x66); pixels[0] = 0;
      parts.push(pixels);
    }
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(decodedOverride ?? Buffer.concat(parts))), chunk("IEND", Buffer.alloc(0))]);
}
async function setOverlays(project: ClipProject, overlays: ClipProject["overlays"]): Promise<EditorTarget> {
  project = { ...project, overlays };
  project.marketingEditor = { ...project.marketingEditor!, digest: editorProjectDigest(project), renderSignature: editorRenderSignature(project) };
  await editProject(() => project);
  return { projectId: project.id, jobId: project.jobId, clipId: "clip-1", revision: project.marketingEditor.revision,
    digest: project.marketingEditor.digest, renderSignature: project.marketingEditor.renderSignature };
}

describe("trusted stored editor overlay raster proof", () => {
  it.each(["png", "jpg", "webp"])("verifies original content-addressed %s bytes and exact dimensions without writes or fetch", async (extension) => {
    const f = await fixture(raster(extension), extension);
    const before = await readFile(document(), "utf8");
    const asset = await resolver().resolve(f.target, "overlay-1");
    expect(asset).toMatchObject({ overlayId: "overlay-1", src: f.src, format: extension === "jpg" ? "jpeg" : extension,
      width: 4, height: 3, sha1: sha1(f.bytes), sha256: createHash("sha256").update(f.bytes).digest("hex"), byteLength: f.bytes.length });
    expect(Object.isFrozen(asset)).toBe(true);
    expect(asset.copyBytes()).toEqual(f.bytes);
    asset.copyBytes().fill(0);
    expect(asset.copyBytes()).toEqual(f.bytes);
    await expect(asset.verifyCurrent()).resolves.toBeUndefined();
    expect(() => asset.assertCurrentFile()).not.toThrow();
    expect(await readFile(document(), "utf8")).toBe(before);
    expect(await readFile(f.file)).toEqual(f.bytes);
    expect((await readdir(root)).sort()).toEqual(["capital-command.json", "overlay-images"]);
    expect(await readdir(images())).toEqual([path.basename(f.file)]);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(loadImage)).toHaveBeenCalledExactlyOnceWith(expect.any(Buffer));
    expect(Object.keys(asset)).not.toContain("filePath");
  });

  it.each(["image", "logo", "watermark"] as const)("accepts original %s overlay references", async (kind) => {
    const f = await fixture();
    await editProject((project) => {
      project.overlays[0].kind = kind;
      project.marketingEditor!.digest = editorProjectDigest(project);
      project.marketingEditor!.renderSignature = editorRenderSignature(project);
      return project;
    });
    const current = (await store.read())!.clipProjects[0].marketingEditor!;
    await expect(resolver().resolve({ ...f.target, digest: current.digest, renderSignature: current.renderSignature }, "overlay-1")).resolves.toMatchObject({ width: 4 });
  });

  it.each([
    "https://example.invalid/private.png", "//example.invalid/image.png", "C:\\private\\image.png", "/private/image.png",
    "/api/clips/overlay-images/../private.png", "/api/clips/overlay-images/%2e%2e.png",
    `/api/clips/overlay-images/${"a".repeat(40)}.png?token=private`, `/api/clips/overlay-images/${"a".repeat(40)}.png#fragment`,
    `/api/clips/overlay-images/${"A".repeat(40)}.png`, `/api/clips/overlay-images/${"a".repeat(40)}.jpeg`,
    `data:image/png;base64,${raster().toString("base64")}`,
    `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>`
  ])("rejects stored URL/path/dataURL forms outside this port without repairing: %s", async (src) => {
    const f = await fixture(raster(), "png", src);
    const before = await readFile(document(), "utf8");
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unsupported" });
    expect(await readFile(document(), "utf8")).toBe(before);
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects wrong owner, record, job, clip and source bindings and never accepts a request URL", async () => {
    const f = await fixture();
    const other = createStoredEditorOverlayResolver({ binding: { ...binding, ownerId: "other-owner" }, store });
    await expect(other.resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "stale_project" });
    for (const target of [{ ...f.target, projectId: "other-project" }, { ...f.target, jobId: "other-job" }, { ...f.target, clipId: "other-clip" },
      { ...f.target, src: f.src }, { ...f.target, revision: 2 }]) {
      await expect(resolver().resolve(target, "overlay-1")).rejects.toBeDefined();
    }
    await expect(resolver().resolve(f.target, f.src)).rejects.toMatchObject({ code: "invalid_binding" });
    await editProject((project) => ({ ...project, sourceFile: "different.mp4" }));
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "stale_project" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("rejects absent/ambiguous enrollment and duplicate, nonimage, deleted or changed stored projects", async () => {
    const f = await fixture();
    expect(() => createStoredEditorOverlayResolver({ binding: { ...binding, records: [...binding.records, binding.records[0]] }, store })).toThrow();
    for (const update of [
      (project: ClipProject) => ({ ...project, marketingEditor: undefined }),
      (project: ClipProject) => ({ ...project, marketingEditor: { ...project.marketingEditor!, deletedAt: "2026-10-21T00:00:00Z" } }),
      (project: ClipProject) => ({ ...project, overlays: [...project.overlays, project.overlays[0]] }),
      (project: ClipProject) => ({ ...project, overlays: [{ ...project.overlays[0], kind: "text" as const }] }),
      (project: ClipProject) => ({ ...project, title: "Changed outside the issued target" })
    ]) {
      const project = update(structuredClone(f.project));
      const reader = { read: async () => ({ clipProjects: [project] }) };
      await expect(createStoredEditorOverlayResolver({ binding, store: reader }).resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "stale_project" });
    }
    await expect(createStoredEditorOverlayResolver({ binding, store: { read: async () => ({ clipProjects: [f.project, f.project] }) } })
      .resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "stale_project" });
  });

  it("rejects missing files, a wrong content-address basename, extension mismatch and invalid compressed data", async () => {
    const f = await fixture();
    await unlink(f.file);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unavailable" });
    await writeFile(f.file, raster("png", "blue"));
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "changed" });
    const badHeader = Buffer.from(f.bytes);
    for (let offset = 8; offset + 12 <= badHeader.length; offset += 12 + badHeader.readUInt32BE(offset)) {
      if (badHeader.toString("ascii", offset + 4, offset + 8) === "IDAT") {
        badHeader.fill(0, offset + 8, offset + 8 + badHeader.readUInt32BE(offset));
        break;
      }
    }
    const malformed = await fixtureAtFreshRoot(badHeader, "png");
    vi.mocked(loadImage).mockClear();
    await expect(resolver().resolve(malformed.target, "overlay-1")).rejects.toMatchObject({ code: "unsupported" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
    const wrongFormat = await fixtureAtFreshRoot(raster(), "jpg");
    await expect(resolver().resolve(wrongFormat.target, "overlay-1")).rejects.toMatchObject({ code: "unsupported" });
  });

  it("validates static interlaced PNG scanlines before native decode", async () => {
    const f = await fixture(png(5, 7, true));
    await expect(resolver().resolve(f.target, "overlay-1")).resolves.toMatchObject({ width: 5, height: 7, format: "png" });
    expect(vi.mocked(loadImage)).toHaveBeenCalledExactlyOnceWith(expect.any(Buffer));
  });

  it.each(["oversized stream", "short stream", "bad row filter", "broken zlib"])("refuses PNG %s even when the container checksum matches", async (kind) => {
    let bytes = kind === "oversized stream" ? png(1, 1, false, Buffer.alloc(5000))
      : kind === "short stream" ? png(1, 1, false, Buffer.alloc(2))
        : kind === "bad row filter" ? png(1, 1, false, Buffer.from([5, 10, 20, 30, 40])) : png(1, 1);
    if (kind === "broken zlib") {
      const data = Buffer.alloc(10);
      bytes = Buffer.concat([bytes.subarray(0, 33), chunk("IDAT", data), chunk("IEND", Buffer.alloc(0))]);
    }
    const f = await fixture(bytes);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unsupported" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("passively proves an explicitly bound legacy revision-zero project without enrollment", async () => {
    const f = await fixture();
    await editProject((project) => ({ ...project, marketingEditor: undefined }));
    const before = await readFile(document(), "utf8");
    const proof = await resolver().resolve({ ...f.target, revision: 0 }, "overlay-1");
    await proof.verifyCurrent();
    expect(await readFile(document(), "utf8")).toBe(before);
    expect((await store.read())!.clipProjects[0].marketingEditor).toBeUndefined();
    await expect(resolver().resolve({ ...f.target, revision: 1 }, "overlay-1")).rejects.toMatchObject({ code: "stale_project" });
  });

  it("returns ordered immutable batch proofs and separates stream metadata checks from commit hashes", async () => {
    const f = await fixture();
    const target = await setOverlays(f.project, ["a", "b", "c"].map((id) => ({ ...f.project.overlays[0], id })));
    const assets = await resolver().resolveMany(target, ["c", "a", "b"]);
    expect(Object.isFrozen(assets)).toBe(true);
    expect(assets.map((asset) => asset.overlayId)).toEqual(["c", "a", "b"]);
    const streaming = assets[0].streamingRead();
    expect(streaming.purpose).toBe("streaming");
    expect(Object.isFrozen(streaming)).toBe(true);
    vi.mocked(fs.readSync).mockClear();
    streaming.assertCurrentFile();
    expect(vi.mocked(fs.readSync)).not.toHaveBeenCalled();
    assets[0].assertCurrentFile();
    expect(vi.mocked(fs.readSync)).toHaveBeenCalled();
    await writeFile(f.file, raster("png", "blue"));
    expect(() => streaming.assertCurrentFile()).toThrow();
  });

  it("preflights batch count and duplicate IDs before any stored-file or decoder work", async () => {
    const f = await fixture();
    const read = vi.fn(store.read);
    const bounded = createStoredEditorOverlayResolver({ binding, store: { read } });
    await expect(bounded.resolveMany(f.target, Array.from({ length: 33 }, (_, i) => `id-${i}`))).rejects.toMatchObject({ code: "invalid_binding" });
    await expect(bounded.resolveMany(f.target, ["overlay-1", "overlay-1"])).rejects.toMatchObject({ code: "invalid_binding" });
    expect(read).not.toHaveBeenCalled();
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("preflights aggregate pixels before any native decode", async () => {
    const bytes = raster();
    const header = Buffer.from(bytes.subarray(16, 29));
    header.writeUInt32BE(4096); header.writeUInt32BE(4096, 4);
    const oversized = Buffer.concat([bytes.subarray(0, 8), chunk("IHDR", header), bytes.subarray(33)]);
    const f = await fixture(oversized);
    const target = await setOverlays(f.project, ["a", "b"].map((id) => ({ ...f.project.overlays[0], id })));
    await expect(resolver().resolveMany(target, ["a", "b"])).rejects.toMatchObject({ code: "unsupported" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("preflights aggregate compressed bytes before any native decode", async () => {
    const bytes = raster();
    const padded = Buffer.concat([bytes.subarray(0, 33), chunk("tEXt", Buffer.alloc(7 * 1024 * 1024)), bytes.subarray(33)]);
    const f = await fixture(padded);
    const target = await setOverlays(f.project, ["a", "b", "c", "d", "e"].map((id) => ({ ...f.project.overlays[0], id })));
    await expect(resolver().resolveMany(target, ["a", "b", "c", "d", "e"])).rejects.toMatchObject({ code: "unsupported" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it.each(["svg", "gif"])("refuses unsupported %s bytes and references", async (extension) => {
    const bytes = extension === "svg" ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>')
      : createCanvas(4, 3).toBuffer("image/gif");
    const f = await fixture(bytes, extension);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unsupported" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it.each(["axis", "pixels", "oversized", "truncated"])("rejects %s limits before native decode", async (kind) => {
    const bytes = raster();
    if (kind === "axis") bytes.writeUInt32BE(STORED_EDITOR_OVERLAY_LIMITS.dimension + 1, 16);
    if (kind === "pixels") { bytes.writeUInt32BE(8192, 16); bytes.writeUInt32BE(8192, 20); }
    const f = await fixture(kind === "truncated" ? bytes.subarray(0, 30) : bytes);
    if (kind === "oversized") await truncate(f.file, STORED_EDITOR_OVERLAY_LIMITS.bytes + 1);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toBeDefined();
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it.each(["APNG", "animated WebP"])("rejects %s without silently selecting a frame", async (kind) => {
    let bytes: Buffer;
    let extension: string;
    if (kind === "APNG") {
      const png = raster();
      const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write("acTL", 4);
      bytes = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]); extension = "png";
    } else {
      const webp = raster("webp");
      const chunk = Buffer.alloc(8); chunk.write("ANIM");
      bytes = Buffer.concat([webp, chunk]); bytes.writeUInt32LE(bytes.length - 8, 4); extension = "webp";
    }
    const f = await fixture(bytes, extension);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unsupported" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("rejects a hardlink alias and a junction below the original data root", async () => {
    const f = await fixture();
    const outside = path.join(root, "original.png");
    await rename(f.file, outside);
    await link(outside, f.file);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unavailable" });
    await unlink(f.file);
    await rename(images(), path.join(root, "actual-images"));
    await rename(outside, path.join(root, "actual-images", path.basename(f.file)));
    await symlink(path.join(root, "actual-images"), images(), process.platform === "win32" ? "junction" : "dir");
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses file-symlink metadata before opening any overlay bytes", async () => {
    // Windows without SeCreateSymbolicLinkPrivilege cannot create a real file
    // symlink. Real junction/hardlink tests above still exercise the filesystem;
    // this deterministic check covers the same lstat guard on a final file.
    const f = await fixture();
    const original = (await vi.importActual<typeof import("node:fs")>("node:fs")).lstatSync;
    const linked = original(f.file);
    linked.isSymbolicLink = () => true;
    vi.mocked(fs.lstatSync).mockImplementation(((file: fs.PathLike, options?: fs.StatOptions) =>
      file === f.file ? linked : original(file, options as { bigint?: false })) as typeof fs.lstatSync);
    const opened = vi.mocked(fs.openSync).mockClear();
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unavailable" });
    expect(opened).not.toHaveBeenCalled();
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("rejects a file swap between checked path metadata and opening the descriptor", async () => {
    const f = await fixture();
    const replacement = path.join(root, "replacement.png");
    await writeFile(replacement, f.bytes);
    const original = (await vi.importActual<typeof import("node:fs")>("node:fs")).openSync;
    vi.mocked(fs.openSync).mockImplementation((file, flags, mode) => {
      if (file === f.file) fs.renameSync(replacement, f.file);
      return original(file, flags, mode);
    });
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "changed" });
    expect(vi.mocked(loadImage)).not.toHaveBeenCalled();
  });

  it("rejects an aliased data-root ancestor, even when its target remains in the fixture", async () => {
    const f = await fixture();
    const alias = path.join(root, "data-alias");
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", alias);
    await expect(resolver().resolve(f.target, "overlay-1")).rejects.toMatchObject({ code: "unavailable" });
    await unlink(alias);
  });

  it("detects same-byte file replacement after proof issuance", async () => {
    const f = await fixture();
    const asset = await resolver().resolve(f.target, "overlay-1");
    await writeFile(path.join(root, "replacement.png"), f.bytes);
    await rename(path.join(root, "replacement.png"), f.file);
    expect(() => asset.assertCurrentFile()).toThrow();
    await expect(asset.verifyCurrent()).rejects.toMatchObject({ code: "changed" });
    expect(asset.copyBytes()).toEqual(f.bytes);
  });

  it("detects changed bytes while retaining the immutable originally verified copy", async () => {
    const f = await fixture();
    const asset = await resolver().resolve(f.target, "overlay-1");
    const changed = Buffer.from(f.bytes);
    changed[changed.length - 1] ^= 1;
    await writeFile(f.file, changed);
    expect(() => asset.assertCurrentFile()).toThrow();
    await expect(asset.verifyCurrent()).rejects.toMatchObject({ code: "changed" });
    expect(asset.copyBytes()).toEqual(f.bytes);
  });

  it("rejects same-size streaming changes even after the original mtime is restored", async () => {
    const f = await fixture();
    const asset = await resolver().resolve(f.target, "overlay-1");
    const streaming = asset.streamingRead();
    const before = fs.statSync(f.file);
    const changed = Buffer.from(f.bytes); changed[changed.length - 1] ^= 1;
    await writeFile(f.file, changed);
    await utimes(f.file, before.atime, before.mtime);
    vi.mocked(fs.readSync).mockClear();
    expect(() => streaming.assertCurrentFile()).toThrow();
    expect(vi.mocked(fs.readSync)).not.toHaveBeenCalled();
    expect(() => asset.assertCurrentFile()).toThrow();
  });

  it("rechecks exact stored ref/revision before and after the full current-file read", async () => {
    const f = await fixture();
    let reads = 0;
    let mutateAt = Number.POSITIVE_INFINITY;
    const changingStore = { read: async () => {
      reads++;
      const project = structuredClone(f.project);
      if (reads >= mutateAt) project.overlays[0].src = "/api/clips/overlay-images/changed.png";
      return { clipProjects: [project] };
    } };
    const asset = await createStoredEditorOverlayResolver({ binding, store: changingStore }).resolve(f.target, "overlay-1");
    mutateAt = reads + 2;
    await expect(asset.verifyCurrent()).rejects.toMatchObject({ code: "stale_project" });
    expect(() => asset.assertCurrentFile()).not.toThrow(); // Byte proof alone is deliberately not a project lock.
    mutateAt = reads + 1;
    await expect(asset.verifyCurrent()).rejects.toMatchObject({ code: "stale_project" });
    await editProject((project) => ({ ...project, marketingEditor: { ...project.marketingEditor!, revision: 4 } }));
    const original = await resolver().resolve({ ...f.target, revision: 4 }, "overlay-1");
    await editProject((project) => ({ ...project, marketingEditor: { ...project.marketingEditor!, deletedAt: "2026-10-21T00:00:00Z" } }));
    await expect(original.verifyCurrent()).rejects.toMatchObject({ code: "stale_project" });
  });
});

async function fixtureAtFreshRoot(bytes: Buffer, extension: string) {
  await rm(images(), { recursive: true });
  return fixture(bytes, extension);
}
