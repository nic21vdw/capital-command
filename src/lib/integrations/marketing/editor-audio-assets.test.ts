import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { emptyData } from "@/lib/mockData/seed";
import { appDataSchema, clipProjectSchema } from "@/lib/storage/schemas";
import type { ClipProject } from "@/types/domain";
import { createStoredEditorMusicResolver, STORED_EDITOR_MUSIC_LIMITS } from "./editor-audio-assets";
import { editorProjectDigest, editorRenderSignature } from "./editor-state";
import type { EditorTarget } from "./editor-types";

let root: string;
let readExistingAppData: typeof import("@/lib/storage/store")["readExistingAppData"];
const binding = { ownerId: "music-owner", records: [{ projectId: "project-1", jobId: "job-1", clipId: "clip-1", sourceFile: "master.mp4" }] };
const store = { read: () => readExistingAppData() };
const resolver = () => createStoredEditorMusicResolver({ binding, store });
const document = () => path.join(root, "capital-command.json");
const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const source = (bytes: Buffer, mime = "audio/wav") => `data:${mime};base64,${bytes.toString("base64")}`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "editor-music-proof-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.resetModules();
  ({ readExistingAppData } = await import("@/lib/storage/store"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in synthetic stored music fixtures."); }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("editor-music-proof-")) throw new Error("Invalid fixture cleanup root.");
  await rm(root, { recursive: true, force: true });
});

function wav(frames = 80, channels: 1 | 2 = 1, rate = 8000): Buffer {
  const bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    bytes.writeInt16LE(Math.round(Math.sin(frame * Math.PI / 8) * 8192), 44 + (frame * channels + channel) * 2);
  }
  return bytes;
}
function targetFor(project: ClipProject, revision = project.marketingEditor?.revision ?? 3): EditorTarget {
  return { projectId: project.id, jobId: project.jobId, clipId: "clip-1", revision,
    digest: editorProjectDigest(project), renderSignature: editorRenderSignature(project) };
}
async function fixture(src: string | undefined = source(wav()), legacy = false) {
  const project = clipProjectSchema.parse({
    id: "project-1", name: "Synthetic original music project", jobId: "job-1", sourceFile: "master.mp4",
    baseDurationSec: 10, clipStart: 20, clipEnd: 30, trimStart: 0, trimEnd: 10,
    audio: { musicSrc: src, musicName: "Synthetic PCM fixture" },
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z"
  });
  const target = targetFor(project, legacy ? 0 : 3);
  if (!legacy) project.marketingEditor = { ownerId: binding.ownerId, jobId: project.jobId, clipId: "clip-1", revision: 3,
    digest: target.digest, renderSignature: target.renderSignature, receipts: [], exports: [] };
  await writeFile(document(), JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project] })));
  return { project, target };
}
async function saveProject(project: ClipProject) {
  const data = JSON.parse(await readFile(document(), "utf8"));
  data.clipProjects = [project];
  await writeFile(document(), JSON.stringify(data));
}
function base64Allocations(spy: { mock: { calls: readonly (readonly unknown[])[] } }) {
  return spy.mock.calls.filter((args) => args[1] === "base64").length;
}

describe("trusted original stored background music proof", () => {
  it.each(["audio/wav", "audio/x-wav", "audio/wave"])("verifies %s PCM16 with immutable identities, defensive copies and no writes", async (mime) => {
    const bytes = wav(240, 2, 48000), src = source(bytes, mime);
    const f = await fixture(src), before = await readFile(document());
    const asset = (await resolver().resolve(f.target))!;
    expect(asset).toMatchObject({ slot: "background_music", format: "wav", mimeType: "audio/wav", demuxer: "wav",
      codec: "pcm_s16le", bitsPerSample: 16, sampleRate: 48000, channels: 2, sampleFrames: 240, durationSec: 0.005,
      byteLength: bytes.length, sha256: sha256(bytes), sourceRefSha256: sha256(src), target: f.target });
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.isFrozen(asset.target)).toBe(true);
    asset.copyBytes().fill(0);
    expect(asset.copyBytes()).toEqual(bytes);
    await asset.verifyCurrent();
    asset.assertCurrentProject(f.project);
    expect(await readFile(document())).toEqual(before);
    expect(await readdir(root)).toEqual(["capital-command.json"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(asset)).not.toMatch(/data:|musicSrc|musicName|filePath/);
  });

  it("supports explicitly bound legacy revision zero without enrolling or repairing", async () => {
    const f = await fixture(source(wav()), true), before = await readFile(document());
    const asset = (await resolver().resolve(f.target))!;
    await asset.verifyCurrent();
    expect(asset.target.revision).toBe(0);
    expect(await readFile(document())).toEqual(before);
    expect((await readExistingAppData())!.clipProjects[0].marketingEditor).toBeUndefined();
    await expect(resolver().resolve({ ...f.target, revision: 1 })).rejects.toMatchObject({ code: "stale_project" });
  });

  it.each([undefined, ""])("returns null for absent music only after current bound project checks (%s)", async (src) => {
    const f = await fixture(src === undefined ? source(wav()) : src);
    if (src === undefined) {
      delete f.project.audio.musicSrc;
      const target = targetFor(f.project);
      Object.assign(f.target, target);
      Object.assign(f.project.marketingEditor!, { digest: target.digest, renderSignature: target.renderSignature });
      await saveProject(f.project);
    }
    const spy = vi.spyOn(Buffer, "from");
    expect(await resolver().resolve(f.target)).toBeNull();
    await expect(resolver().resolve({ ...f.target, revision: 99 })).rejects.toMatchObject({ code: "stale_project" });
    expect(base64Allocations(spy)).toBe(0);
  });

  it.each(["owner", "project", "job", "clip", "source", "revision", "digest", "deleted"])("rejects %s scope or target before decoding", async (kind) => {
    const f = await fixture();
    if (kind === "owner") f.project.marketingEditor!.ownerId = "foreign-owner";
    if (kind === "project") f.target.projectId = "unlisted-project";
    if (kind === "job") f.target.jobId = "foreign-job";
    if (kind === "clip") f.target.clipId = "foreign-clip";
    if (kind === "source") f.project.sourceFile = "other.mp4";
    if (kind === "revision") f.target.revision += 1;
    if (kind === "digest") f.target.digest = "0".repeat(64);
    if (kind === "deleted") f.project.marketingEditor!.deletedAt = "2026-10-02T00:00:00.000Z";
    await saveProject(f.project);
    const spy = vi.spyOn(Buffer, "from");
    await expect(resolver().resolve(f.target)).rejects.toMatchObject({ name: "StoredEditorMusicError" });
    expect(base64Allocations(spy)).toBe(0);
  });

  it("never accepts request source/path fields or an unbound selector, and never reads outside the original store", async () => {
    const f = await fixture();
    const read = vi.fn(store.read), scoped = createStoredEditorMusicResolver({ binding, store: { read } });
    for (const extra of [{ musicSrc: source(wav()) }, { path: "C:/private.wav" }, { overlayId: "sfx-1" }]) {
      await expect(scoped.resolve({ ...f.target, ...extra })).rejects.toMatchObject({ code: "invalid_binding" });
    }
    await expect(scoped.resolve({ ...f.target, projectId: "foreign" })).rejects.toMatchObject({ code: "invalid_binding" });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects duplicated, missing and unavailable original rows with safe errors", async () => {
    const f = await fixture();
    for (const projects of [[], [f.project, f.project]]) {
      await expect(createStoredEditorMusicResolver({ binding, store: { read: async () => ({ clipProjects: projects }) } }).resolve(f.target))
        .rejects.toMatchObject({ code: "stale_project" });
    }
    await expect(createStoredEditorMusicResolver({ binding, store: { read: async () => { throw new Error("SECRET C:/private.wav"); } } }).resolve(f.target))
      .rejects.toMatchObject({ code: "unavailable", message: "The bound stored background music could not be verified." });
    expect(() => createStoredEditorMusicResolver({ binding: { ...binding, records: [...binding.records, ...binding.records] }, store }))
      .toThrowError("The bound stored background music could not be verified.");
  });

  it.each([
    "https://example.invalid/music.wav", "C:/private.wav", "file:///private.wav", "/api/audio/library/sfx-1",
    "data:audio/mpeg;base64,SUQzAAAA", "data:audio/ogg;base64,T2dnUw==", "data:audio/flac;base64,ZkxhQw==",
    "data:application/octet-stream;base64,UklGRg==", "data:audio/WAV;base64,UklGRg==", "data:audio/wav;charset=utf-8;base64,UklGRg==",
    "data:audio/wav;base64,", "data:audio/wav;base64,AAA", "data:audio/wav;base64,AA=A", "data:audio/wav;base64,A===",
    "data:audio/wav;base64,AA==\n", "data:audio/wav;base64,A A=", "data:audio/wav;base64,%41A==", "data:audio/wav;base64,____"
  ])("rejects unsupported stored reference case %# without network", async (src) => {
    const f = await fixture(src);
    await expect(resolver().resolve(f.target)).rejects.toMatchObject({ code: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects noncanonical unused base64 bits even when Buffer decoding would accept them", async () => {
    const canonical = source(wav(1));
    expect(canonical.endsWith("AA==")).toBe(true);
    const src = canonical.slice(0, -3) + "B==";
    const f = await fixture(src);
    await expect(resolver().resolve(f.target)).rejects.toMatchObject({ code: "unsupported" });
  });

  it.each(["encoded", "predicted"])("checks %s byte limit before base64 allocation", async (kind) => {
    const payload = "A".repeat(STORED_EDITOR_MUSIC_LIMITS.base64Characters + (kind === "encoded" ? 4 : 0));
    const f = await fixture(`data:audio/wav;base64,${payload}`);
    const spy = vi.spyOn(Buffer, "from");
    await expect(resolver().resolve(f.target)).rejects.toMatchObject({ code: "unsupported" });
    expect(base64Allocations(spy)).toBe(0);
  });

  const corruptions: [string, (bytes: Buffer) => Buffer][] = [
    ...[0, 8, 12, 36].map((offset): [string, (bytes: Buffer) => Buffer] => [`high-bit FourCC at ${offset}`, (b) => {
      for (let i = offset; i < offset + 4; i++) b[i] |= 0x80;
      return b;
    }]),
    ["truncated header", (b) => b.subarray(0, 20)],
    ["RIFF length mismatch", (b) => { b.writeUInt32LE(b.length - 7, 4); return b; }],
    ["RF64", (b) => { b.write("RF64"); return b; }], ["RIFX", (b) => { b.write("RIFX"); return b; }],
    ["foreign container", (b) => { b.write("AVI ", 8); return b; }],
    ["fmt extension", (b) => { b.writeUInt32LE(18, 16); return b; }],
    ["compressed PCM", (b) => { b.writeUInt16LE(3, 20); return b; }],
    ["extensible PCM", (b) => { b.writeUInt16LE(0xfffe, 20); return b; }],
    ["zero channels", (b) => { b.writeUInt16LE(0, 22); return b; }],
    ["surround channels", (b) => { b.writeUInt16LE(3, 22); return b; }],
    ["low sample rate", (b) => { b.writeUInt32LE(7999, 24); return b; }],
    ["high sample rate", (b) => { b.writeUInt32LE(48001, 24); return b; }],
    ["byte rate mismatch", (b) => { b.writeUInt32LE(1, 28); return b; }],
    ["block alignment mismatch", (b) => { b.writeUInt16LE(1, 32); return b; }],
    ["24-bit samples", (b) => { b.writeUInt16LE(24, 34); return b; }],
    ["empty data", (b) => { b = b.subarray(0, 44); b.writeUInt32LE(36, 4); b.writeUInt32LE(0, 40); return b; }],
    ["unaligned data", (b) => { b.writeUInt32LE(b.length - 45, 40); b[b.length - 1] = 0; return b; }],
    ["data overrun", (b) => { b.writeUInt32LE(b.length, 40); return b; }],
    ["data before fmt", (b) => { b.write("data", 12); return b; }],
    ...["LIST", "JUNK", "cue ", "plst", "fmt ", "data"].map((kind): [string, (bytes: Buffer) => Buffer] => [`trailing ${kind}`, (b) => {
      const chunk = Buffer.alloc(8); chunk.write(kind);
      const out = Buffer.concat([b, chunk]); out.writeUInt32LE(out.length - 8, 4); return out;
    }]),
    ["missing data", (b) => { b.write("JUNK", 36); return b; }],
    ["unknown chunk before fmt", (b) => { b.write("LIST", 12); return b; }],
    ["trailing unframed byte", (b) => { const out = Buffer.concat([b, Buffer.from([0])]); out.writeUInt32LE(out.length - 8, 4); return out; }]
  ];
  it.each(corruptions)("rejects %s WAV structure", async (_name, corrupt) => {
    const f = await fixture(source(corrupt(wav())));
    await expect(resolver().resolve(f.target)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("rejects more than 600 seconds before allocation because the byte cap is stricter", async () => {
    const bytes = wav(8000 * 600 + 1);
    expect(bytes.length).toBeGreaterThan(STORED_EDITOR_MUSIC_LIMITS.bytes);
    const f = await fixture(source(bytes));
    const spy = vi.spyOn(Buffer, "from");
    await expect(resolver().resolve(f.target)).rejects.toMatchObject({ code: "unsupported" });
    expect(base64Allocations(spy)).toBe(0);
  });

  it("accepts 300 seconds and the exact 8 MiB byte boundary", async () => {
    for (const bytes of [wav(8000 * 600 / 2, 1, 8000), wav((STORED_EDITOR_MUSIC_LIMITS.bytes - 44) / 4, 2, 48000)]) {
      const f = await fixture(source(bytes));
      const asset = (await resolver().resolve(f.target))!;
      expect(asset.byteLength).toBe(bytes.length);
    }
    // The byte cap is stricter than 600 seconds at the lowest supported PCM16 rate.
    expect(wav(8000 * 600).length).toBeGreaterThan(STORED_EDITOR_MUSIC_LIMITS.bytes);
  });

  it("fences a source or target changed between the first read and proof issuance", async () => {
    const f = await fixture(), changed = structuredClone(f.project);
    changed.audio.musicSrc = source(wav(81));
    const read = vi.fn().mockResolvedValueOnce({ clipProjects: [f.project] }).mockResolvedValue({ clipProjects: [changed] });
    await expect(createStoredEditorMusicResolver({ binding, store: { read } }).resolve(f.target)).rejects.toMatchObject({ code: "stale_project" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(["bytes", "mime", "volume", "name", "revision", "owner", "job", "source", "deleted"])("detached guards reject a later %s change and keep prior copies immutable", async (kind) => {
    const f = await fixture(), asset = (await resolver().resolve(f.target))!;
    const { assertCurrentProject, verifyCurrent } = asset;
    const original = asset.copyBytes(), changed = structuredClone(f.project);
    if (kind === "bytes") changed.audio.musicSrc = source(wav(81));
    if (kind === "mime") changed.audio.musicSrc = changed.audio.musicSrc!.replace("audio/wav", "audio/wave");
    if (kind === "volume") changed.audio.musicVolume = 0.25;
    if (kind === "name") changed.audio.musicName = "Renamed synthetic fixture";
    if (kind === "revision") changed.marketingEditor!.revision++;
    if (kind === "owner") changed.marketingEditor!.ownerId = "foreign-owner";
    if (kind === "job") changed.jobId = "other-job";
    if (kind === "source") changed.sourceFile = "other.mp4";
    if (kind === "deleted") changed.marketingEditor!.deletedAt = "2026-10-03T00:00:00.000Z";
    expect(() => assertCurrentProject(changed)).toThrowError("The bound stored background music could not be verified.");
    await saveProject(changed);
    const spy = vi.spyOn(Buffer, "from");
    await expect(verifyCurrent()).rejects.toMatchObject({ code: "stale_project" });
    expect(base64Allocations(spy)).toBe(0);
    expect(asset.copyBytes()).toEqual(original);
  });

  it("decodes only verified scratch bytes with an explicit WAV demuxer and local file protocols", async () => {
    const bytes = wav(160, 2), ascii = Buffer.from("file:///do-not-read #EXTM3U https://example.invalid/music\n");
    ascii.copy(bytes, 44); // These are PCM samples, never a playlist or another input reference.
    const f = await fixture(source(bytes)), asset = (await resolver().resolve(f.target))!;
    const input = path.join(root, "music.audio"), output = path.join(root, "decoded.pcm");
    await writeFile(input, asset.copyBytes());
    const bin = resolveFfmpeg();
    expect(bin).toBeTruthy();
    await promisify(execFile)(bin!, ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file",
      "-f", asset.demuxer, "-i", input, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "s16le", output],
    { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
    expect(await readFile(output)).toEqual(bytes.subarray(44));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects disguised HLS and concat bytes before any downstream decode", async () => {
    for (const text of ["#EXTM3U\n#EXTINF:10,\nfile:///private.wav\n", "ffconcat version 1.0\nfile 'private.wav'\n"]) {
      const f = await fixture(source(Buffer.from(text)));
      await expect(resolver().resolve(f.target)).rejects.toMatchObject({ code: "unsupported" });
    }
    expect(await readdir(root)).toEqual(["capital-command.json"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
