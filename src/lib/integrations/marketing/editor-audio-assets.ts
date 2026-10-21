import { createHash } from "node:crypto";
import type { ClipProject } from "@/types/domain";
import { editorProjectDigest, editorRenderSignature } from "./editor-state";
import { editorTargetSchema, type EditorBinding, type EditorRecordBinding, type EditorTarget } from "./editor-types";

export const STORED_EDITOR_MUSIC_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024,
  base64Characters: 4 * Math.ceil(8 * 1024 * 1024 / 3), minSampleRate: 8000, maxSampleRate: 48000, durationSec: 600 });
type Store = { read(): Promise<{ clipProjects: ClipProject[] } | null> };
export class StoredEditorMusicError extends Error {
  constructor(readonly code: "invalid_binding" | "stale_project" | "unsupported" | "unavailable") {
    super("The bound stored background music could not be verified.");
    this.name = "StoredEditorMusicError";
  }
}
const fail = (code: StoredEditorMusicError["code"]): never => { throw new StoredEditorMusicError(code); };
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);
const fileName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 255
  && !value.startsWith(".") && !/[\\/:\u0000-\u001f\u007f]/.test(value);

export type StoredEditorMusicIdentity = Readonly<{
  slot: "background_music"; format: "wav"; mimeType: "audio/wav";
  /** Every downstream FFmpeg read MUST force -f wav before -i. Never autodetect. */
  demuxer: "wav"; codec: "pcm_s16le"; bitsPerSample: 16;
  sampleRate: number; channels: 1 | 2; sampleFrames: number; durationSec: number;
  byteLength: number; sha256: string; sourceRefSha256: string;
  target: Readonly<EditorTarget>;
}>;
export type StoredEditorMusicAsset = StoredEditorMusicIdentity & Readonly<{
  copyBytes(): Buffer;
  /** Fresh original-row read; does not acquire its mutation lock. */
  verifyCurrent(): Promise<void>;
  /** Pass the actual stored row inside the original project mutation lock. */
  assertCurrentProject(project: Readonly<ClipProject>): void;
}>;

function assertProject(project: Readonly<ClipProject>, ownerId: string, record: Readonly<EditorRecordBinding>, target: Readonly<EditorTarget>): void {
  const state = project.marketingEditor;
  if (project.id !== record.projectId || project.jobId !== record.jobId || project.sourceFile !== record.sourceFile
    || (state ? state.deletedAt || state.ownerId !== ownerId || state.jobId !== record.jobId || state.clipId !== record.clipId
      || state.revision !== target.revision || state.digest !== target.digest || state.renderSignature !== target.renderSignature : target.revision !== 0)
    || editorProjectDigest(project) !== target.digest || editorRenderSignature(project) !== target.renderSignature) fail("stale_project");
}
async function readProject(store: Store, ownerId: string, record: Readonly<EditorRecordBinding>, target: Readonly<EditorTarget>): Promise<ClipProject> {
  let projects: ClipProject[];
  try { projects = (await store.read())?.clipProjects.filter((project) => project.id === record.projectId) ?? []; }
  catch { return fail("unavailable"); }
  if (projects.length !== 1) return fail("stale_project");
  const project = structuredClone(projects[0]);
  assertProject(project, ownerId, record, target);
  return project;
}

// Factory scope contains only the reader, primitive identities and frozen small
// binding/target objects. Extracted guards retain no source string or PCM Buffer.
function createGuards(store: Store, ownerId: string, record: Readonly<EditorRecordBinding>, target: Readonly<EditorTarget>, expectedSourceRef: string) {
  function assertCurrentProject(project: Readonly<ClipProject>): void {
    assertProject(project, ownerId, record, target);
    if (typeof project.audio.musicSrc !== "string" || sha256(project.audio.musicSrc) !== expectedSourceRef) fail("stale_project");
  }
  async function verifyCurrent(): Promise<void> {
    assertCurrentProject(await readProject(store, ownerId, record, target));
  }
  return { assertCurrentProject, verifyCurrent };
}

function decodeStoredSource(src: string): Buffer {
  // Prefix allowance is bounded before regex capture or a base64 allocation.
  if (src.length > STORED_EDITOR_MUSIC_LIMITS.base64Characters + 32) return fail("unsupported");
  const match = /^data:audio\/(?:wav|x-wav|wave);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[0] !== src) return fail("unsupported");
  const payload = match[1];
  if (payload.length % 4 || payload.length > STORED_EDITOR_MUSIC_LIMITS.base64Characters) return fail("unsupported");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const predicted = payload.length / 4 * 3 - padding;
  if (predicted < 1 || predicted > STORED_EDITOR_MUSIC_LIMITS.bytes) return fail("unsupported");
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length !== predicted || bytes.toString("base64") !== payload) return fail("unsupported");
  return bytes;
}

/** Only classic PCM16 fmt16 followed by one data chunk; no metadata allowlist. */
function inspectWav(bytes: Buffer) {
  if (bytes.length < 46 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WAVE"
    || bytes.readUInt32LE(4) !== bytes.length - 8) return fail("unsupported");
  let sampleRate = 0, channels = 0, blockAlign = 0, dataBytes = 0, seenFormat = false, seenData = false;
  let offset = 12;
  for (; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("latin1", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length, next = end + (length & 1);
    if (next > bytes.length || ((length & 1) && bytes[end] !== 0)) return fail("unsupported");
    if (kind === "fmt ") {
      if (seenFormat || seenData || offset !== 12 || length !== 16 || bytes.readUInt16LE(start) !== 1
        || bytes.readUInt16LE(start + 14) !== 16) return fail("unsupported");
      channels = bytes.readUInt16LE(start + 2); sampleRate = bytes.readUInt32LE(start + 4);
      blockAlign = bytes.readUInt16LE(start + 12);
      if (![1, 2].includes(channels) || sampleRate < STORED_EDITOR_MUSIC_LIMITS.minSampleRate || sampleRate > STORED_EDITOR_MUSIC_LIMITS.maxSampleRate
        || blockAlign !== channels * 2 || bytes.readUInt32LE(start + 8) !== sampleRate * blockAlign) return fail("unsupported");
      seenFormat = true;
    } else if (kind === "data") {
      if (!seenFormat || seenData || next !== bytes.length || length < blockAlign || length % blockAlign) return fail("unsupported");
      dataBytes = length; seenData = true;
    } else return fail("unsupported");
    offset = next;
  }
  if (offset !== bytes.length || !seenFormat || !seenData) return fail("unsupported");
  const sampleFrames = dataBytes / blockAlign;
  const durationSec = sampleFrames / sampleRate;
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > STORED_EDITOR_MUSIC_LIMITS.durationSec) return fail("unsupported");
  return { sampleRate, channels: channels as 1 | 2, sampleFrames, durationSec };
}

/**
 * Read-only trusted original-store helper. Never accept request projects, source
 * strings, paths, URLs or selector IDs here. Only the bound project's music slot
 * is inspected; generated music libraries and SFX are outside this authority.
 * Absent music returns null only after current project authorization. Legacy 0
 * uses the existing explicit binding without enrollment or repair. No decoder,
 * filesystem scratch, network, upload or original store writes are performed.
 * This narrow proof alone does not enable audition or preparation rendering.
 */
export function createStoredEditorMusicResolver(options: { binding: EditorBinding; store: Store }) {
  const binding = structuredClone(options.binding);
  if (!binding.ownerId?.trim() || binding.ownerId.length > 128 || !Array.isArray(binding.records)
    || binding.records.some((record) => ![record.projectId, record.jobId, record.clipId].every(id) || !fileName(record.sourceFile))
    || new Set(binding.records.map((record) => record.projectId)).size !== binding.records.length || typeof options.store?.read !== "function") fail("invalid_binding");
  return {
    async resolve(input: EditorTarget): Promise<StoredEditorMusicAsset | null> {
      const parsed = editorTargetSchema.safeParse(input);
      if (!parsed.success) return fail("invalid_binding");
      const target = Object.freeze({ ...parsed.data });
      const original = binding.records.find((record) => record.projectId === target.projectId);
      if (!original || original.jobId !== target.jobId || original.clipId !== target.clipId) return fail("invalid_binding");
      const record = Object.freeze({ projectId: original.projectId, jobId: original.jobId, clipId: original.clipId, sourceFile: original.sourceFile });
      const project = await readProject(options.store, binding.ownerId, record, target);
      const src = project.audio.musicSrc;
      if (src === undefined || src === "") return null;
      if (typeof src !== "string") return fail("unsupported");
      const bytes = decodeStoredSource(src);
      const audio = inspectWav(bytes);
      const sourceRefSha256 = sha256(src);
      const guards = createGuards(options.store, binding.ownerId, record, target, sourceRefSha256);
      await guards.verifyCurrent();
      return Object.freeze({ slot: "background_music" as const, format: "wav" as const, mimeType: "audio/wav" as const,
        demuxer: "wav" as const, codec: "pcm_s16le" as const, bitsPerSample: 16 as const, ...audio,
        target, sourceRefSha256, sha256: sha256(bytes), byteLength: bytes.length,
        copyBytes: () => Buffer.from(bytes), ...guards });
    }
  };
}
