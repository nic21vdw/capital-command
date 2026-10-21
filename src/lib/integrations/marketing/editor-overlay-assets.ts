import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { loadImage } from "@napi-rs/canvas";
import { dataPath } from "@/lib/paths";
import type { ClipProject } from "@/types/domain";
import { editorProjectDigest, editorRenderSignature } from "./editor-state";
import { editorTargetSchema, type EditorBinding, type EditorTarget } from "./editor-types";

export const STORED_EDITOR_OVERLAY_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, dimension: 8192, pixels: 16 * 1024 * 1024,
  assets: 32, totalBytes: 32 * 1024 * 1024, totalPixels: 16 * 1024 * 1024 });
type Format = "png" | "jpeg" | "webp";
type Header = { format: Format; width: number; height: number };
type Store = { read(): Promise<{ clipProjects: ClipProject[] } | null> };
export class StoredEditorOverlayError extends Error {
  constructor(readonly code: "invalid_binding" | "stale_project" | "unsupported" | "unavailable" | "changed") {
    super("The bound stored overlay image could not be verified.");
    this.name = "StoredEditorOverlayError";
  }
}
const fail = (code: StoredEditorOverlayError["code"]): never => { throw new StoredEditorOverlayError(code); };
const hash = (algorithm: "sha1" | "sha256", bytes: Buffer): string => createHash(algorithm).update(bytes).digest("hex");
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fileName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 255
  && !value.startsWith(".") && !/[\\/:\u0000-\u001f\u007f]/.test(value);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function dimensions(header: Header): Header {
  if (!Number.isSafeInteger(header.width) || !Number.isSafeInteger(header.height) || header.width < 1 || header.height < 1
    || header.width > STORED_EDITOR_OVERLAY_LIMITS.dimension || header.height > STORED_EDITOR_OVERLAY_LIMITS.dimension
    || header.width * header.height > STORED_EDITOR_OVERLAY_LIMITS.pixels) fail("unsupported");
  return header;
}

// Inspect container dimensions before invoking a native decoder. Only static
// rasters are supported; the original externalizer uses jpg, never jpeg.
function inspect(bytes: Buffer, extension: string): Header {
  if (extension === "png") {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") fail("unsupported");
    const header = dimensions({ format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
    const bitDepth = bytes[24], color = bytes[25], interlace = bytes[28];
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
    if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth) || ([2, 4, 6].includes(color) && bitDepth < 8)
      || (color === 3 && bitDepth > 8) || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) fail("unsupported");
    let image = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) fail("unsupported");
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail("unsupported");
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT" || (kind === "IHDR" && offset !== 8)) fail("unsupported");
      if (kind === "IDAT") image = true;
      if (kind === "IEND") {
        if (length !== 0 || end !== bytes.length || !image) fail("unsupported");
        return header;
      }
      offset = end;
    }
    return fail("unsupported");
  }
  if (extension === "jpg") {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) fail("unsupported");
    let header: Header | undefined;
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 0xff) fail("unsupported");
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) return header ?? fail("unsupported");
      if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9 || offset + 2 > bytes.length) fail("unsupported");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) fail("unsupported");
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (![0xc0, 0xc1, 0xc2].includes(marker) || length < 8 || header) fail("unsupported");
        header = dimensions({ format: "jpeg", width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) });
      }
      offset += length;
    }
    return fail("unsupported");
  }
  if (extension !== "webp" || bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) !== bytes.length - 8) return fail("unsupported");
  let canvas: Header | undefined;
  let image: Header | undefined;
  let offset = 12;
  for (; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length || kind === "ANIM" || kind === "ANMF") fail("unsupported");
    if (kind === "VP8X") {
      if (length !== 10 || canvas || (bytes[start] & 0x02)) fail("unsupported");
      canvas = dimensions({ format: "webp", width: 1 + bytes.readUIntLE(start + 4, 3), height: 1 + bytes.readUIntLE(start + 7, 3) });
    } else if (kind === "VP8 ") {
      if (image || length < 10 || (bytes[start] & 1) || bytes.subarray(start + 3, start + 6).toString("hex") !== "9d012a") fail("unsupported");
      image = dimensions({ format: "webp", width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff });
    } else if (kind === "VP8L") {
      if (image || length < 5 || bytes[start] !== 0x2f) fail("unsupported");
      const packed = bytes.readUInt32LE(start + 1);
      if (packed >>> 29) fail("unsupported");
      image = dimensions({ format: "webp", width: 1 + (packed & 0x3fff), height: 1 + ((packed >>> 14) & 0x3fff) });
    }
    offset = end + (length & 1);
  }
  if (offset !== bytes.length || !image || (canvas && (canvas.width !== image.width || canvas.height !== image.height))) fail("unsupported");
  return image ?? fail("unsupported");
}

/** PNG decoders may accept damaged IDAT streams. Validate the bounded stream too. */
function validatePngStream(bytes: Buffer, header: Header): void {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]];
  const bits = channels * bytes[24];
  const passes = bytes[28] === 0 ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const rows = passes.flatMap(([x, y, dx, dy]) => {
    const width = Math.max(0, Math.ceil((header.width - x) / dx));
    const height = Math.max(0, Math.ceil((header.height - y) / dy));
    return width && height ? [{ length: 1 + Math.ceil(width * bits / 8), height }] : [];
  });
  const expected = rows.reduce((sum, row) => sum + row.length * row.height, 0);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32BE(offset)));
  }
  try {
    const decoded = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
    if (decoded.length !== expected) fail("unsupported");
    let offset = 0;
    for (const row of rows) for (let i = 0; i < row.height; i++, offset += row.length) if (decoded[offset] > 4) fail("unsupported");
  } catch { fail("unsupported"); }
}

function comparable(file: string): string {
  const absolute = path.resolve(file);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
/** Reject all aliases, including in-root Windows junctions and ancestor links. */
function assertNoAlias(file: string): void {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of absolute.slice(root.length).split(path.sep)) {
    current = path.join(current, segment);
    if (lstatSync(current).isSymbolicLink() || comparable(realpathSync(current)) !== comparable(current)) fail("unavailable");
  }
}
function identity(info: BigIntStats): string {
  if (!info.isFile() || info.nlink !== 1n || info.size < 1n || info.size > BigInt(STORED_EDITOR_OVERLAY_LIMITS.bytes)) fail("unavailable");
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}
function readBoundFile(file: string): { bytes: Buffer; identity: string } {
  let fd: number | undefined;
  try {
    assertNoAlias(file);
    const before = lstatSync(file, { bigint: true });
    const expected = identity(before);
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (identity(fstatSync(fd, { bigint: true })) !== expected) fail("changed");
    // One extra byte detects growth; never call unbounded readFile on the path.
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = readSync(fd, bytes, count, bytes.length - count, count);
      if (!next) break;
      count += next;
    }
    assertNoAlias(file);
    if (count !== Number(before.size) || identity(fstatSync(fd, { bigint: true })) !== expected
      || identity(lstatSync(file, { bigint: true })) !== expected) fail("changed");
    return { bytes: bytes.subarray(0, count), identity: expected };
  } catch (error) {
    if (error instanceof StoredEditorOverlayError) throw error;
    return fail("unavailable");
  } finally { if (fd !== undefined) closeSync(fd); }
}

function currentIdentity(file: string): string {
  try {
    assertNoAlias(file);
    const before = identity(lstatSync(file, { bigint: true }));
    assertNoAlias(file);
    if (identity(lstatSync(file, { bigint: true })) !== before) fail("changed");
    return before;
  } catch (error) {
    if (error instanceof StoredEditorOverlayError) throw error;
    return fail("unavailable");
  }
}

export type StoredEditorOverlayStreamingRead = Readonly<{
  purpose: "streaming";
  /** Metadata/alias guard only, valid after a full proof. Never a commit proof. */
  assertCurrentFile(): void;
}>;

export type StoredEditorOverlayAsset = Readonly<Header & {
  overlayId: string; src: string; sha1: string; sha256: string; byteLength: number;
  /** A defensive copy of the verified raster, suitable for private render scratch. */
  copyBytes(): Buffer;
  /** Full byte and stored project/ref recheck. Does not acquire a project commit lock. */
  verifyCurrent(): Promise<void>;
  /** Full byte recheck only. Caller must also check the exact project under its commit lock. */
  assertCurrentFile(): void;
  /** Stream-cache helper only; recheck current owner/project/ref separately on every hit. */
  streamingRead(): StoredEditorOverlayStreamingRead;
}>;

/**
 * Trusted worker helper, not a route or an authorization service. Supply the
 * original stored project reader and explicit existing-record binding, never a
 * request project, URL or path. No store repair, writes, network or enrollment.
 * Legacy revision-zero rows use the same explicit trusted binding as editor
 * reads; they are never enrolled or changed. Legacy data URLs remain untouched
 * and unsupported by this stored-file port.
 * This proof alone does not enable image rendering or publication.
 */
export function createStoredEditorOverlayResolver(options: { binding: EditorBinding; store: Store }) {
  const binding = structuredClone(options.binding);
  if (!binding.ownerId?.trim() || binding.ownerId.length > 128 || !Array.isArray(binding.records)
    || binding.records.some((record) => ![record.projectId, record.jobId, record.clipId].every(id) || !fileName(record.sourceFile))
    || new Set(binding.records.map((record) => record.projectId)).size !== binding.records.length
    || typeof options.store?.read !== "function") fail("invalid_binding");
  async function resolveMany(input: EditorTarget, overlayIds: readonly string[]): Promise<readonly StoredEditorOverlayAsset[]> {
      const parsed = editorTargetSchema.safeParse(input);
      if (!parsed.success || !Array.isArray(overlayIds) || overlayIds.length > STORED_EDITOR_OVERLAY_LIMITS.assets
        || !overlayIds.every(id) || new Set(overlayIds).size !== overlayIds.length) return fail("invalid_binding");
      const ids = [...overlayIds];
      const target = Object.freeze({ ...parsed.data });
      const record = binding.records.find((candidate) => candidate.projectId === target.projectId);
      if (!record || target.jobId !== record.jobId || target.clipId !== record.clipId) return fail("invalid_binding");
      async function current(): Promise<string[]> {
        const projects = (await options.store.read())?.clipProjects.filter((project) => project.id === target.projectId) ?? [];
        if (projects.length !== 1) return fail("stale_project");
        const project = structuredClone(projects[0]);
        const state = project.marketingEditor;
        if (project.jobId !== record!.jobId || project.sourceFile !== record!.sourceFile
          || (state ? state.deletedAt || state.ownerId !== binding.ownerId || state.jobId !== record!.jobId || state.clipId !== record!.clipId
            || state.revision !== target.revision || state.digest !== target.digest || state.renderSignature !== target.renderSignature : target.revision !== 0)
          || editorProjectDigest(project) !== target.digest || editorRenderSignature(project) !== target.renderSignature) return fail("stale_project");
        return ids.map((overlayId) => {
          const overlays = project.overlays.filter((overlay) => overlay.id === overlayId);
          if (overlays.length !== 1 || !["image", "logo", "watermark"].includes(overlays[0].kind)
            || typeof overlays[0].src !== "string") return fail("stale_project");
          return overlays[0].src;
        });
      }
      const sources = await current();
      // Root is fixed once for this proof; changing process configuration cannot
      // redirect a previously issued proof into another data directory.
      const root = path.resolve(dataPath("overlay-images"));
      let totalBytes = 0, totalPixels = 0;
      const files = sources.map((src, index) => {
        const match = /^\/api\/clips\/overlay-images\/([a-f0-9]{40})\.(png|jpg|webp)$/.exec(src);
        if (!match) return fail("unsupported");
        const [sha1, extension] = match.slice(1);
        const file = path.join(root, `${sha1}.${extension}`);
        if (path.relative(root, file) !== `${sha1}.${extension}`) return fail("invalid_binding");
        const initial = readBoundFile(file);
        totalBytes += initial.bytes.length;
        if (totalBytes > STORED_EDITOR_OVERLAY_LIMITS.totalBytes) fail("unsupported");
        if (hash("sha1", initial.bytes) !== sha1) return fail("changed");
        const header = inspect(initial.bytes, extension);
        totalPixels += header.width * header.height;
        if (totalPixels > STORED_EDITOR_OVERLAY_LIMITS.totalPixels) fail("unsupported");
        return { src, file, sha1, initial, header, overlayId: ids[index] };
      });
      // All batch byte/pixel/count caps pass before ANY native raster decode.
      for (const { initial, header } of files) {
        if (header.format === "png") validatePngStream(initial.bytes, header);
        try {
          // Always a Buffer. Never pass a stored URL/path to a native loader.
          const decoded = await loadImage(initial.bytes);
          if (decoded.width !== header.width || decoded.height !== header.height) fail("unsupported");
        } catch { return fail("unsupported"); }
      }
      async function assertProject(): Promise<void> {
        const latest = await current();
        if (latest.some((src, index) => src !== sources[index])) fail("stale_project");
      }
      const assets = files.map(({ src, file, sha1, initial, header, overlayId }): StoredEditorOverlayAsset => {
        const sha256 = hash("sha256", initial.bytes);
        function assertCurrentFile(): void {
          const latest = readBoundFile(file);
          if (latest.identity !== initial.identity || hash("sha256", latest.bytes) !== sha256) fail("changed");
        }
        async function verifyCurrent(): Promise<void> {
          await assertProject();
          assertCurrentFile();
          await assertProject();
        }
        return Object.freeze({ ...header, overlayId, src, sha1, sha256, byteLength: initial.bytes.length,
          copyBytes: () => Buffer.from(initial.bytes), verifyCurrent, assertCurrentFile,
          streamingRead: () => Object.freeze({ purpose: "streaming" as const, assertCurrentFile: () => {
            if (currentIdentity(file) !== initial.identity) fail("changed");
          } }) });
      });
      await assertProject();
      assets.forEach((asset) => asset.assertCurrentFile());
      await assertProject();
      return Object.freeze(assets);
  }
  return {
    resolveMany,
    async resolve(input: EditorTarget, overlayId: string): Promise<StoredEditorOverlayAsset> {
      return (await resolveMany(input, [overlayId]))[0];
    }
  };
}
