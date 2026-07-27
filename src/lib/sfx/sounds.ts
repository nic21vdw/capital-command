import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hasAudioStream, hasVideoStream, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { SFX_SOUND_IDS, isSfxSoundId } from "@/lib/sfx/types";
import type { SfxSoundId } from "@/types/domain";

// Server-side storage for the viral sound-effect slots. Each slot resolves to
// either the user's uploaded file (data/sfx/custom/<id>/) or, when nothing has
// been uploaded, a best-effort stand-in synthesized once with ffmpeg into
// data/sfx/defaults/. The synthesized sounds only sketch the real memes —
// uploading the actual MP3s is the intended path to the authentic effects.

const sfxRoot = path.join(process.cwd(), "data", "sfx");
const indexFile = path.join(sfxRoot, "library.json");
let indexQueue = Promise.resolve();

export type SfxCustomSound = {
  fileName: string;
  storedName: string;
  mime: string;
  sizeBytes: number;
  durationSec: number;
  updatedAt: string;
};

export type SfxSoundStatus = {
  id: SfxSoundId;
  /** The uploaded replacement, or null while the slot plays its stand-in. */
  custom: SfxCustomSound | null;
};

type SfxIndex = Partial<Record<SfxSoundId, SfxCustomSound>>;

// ffmpeg aevalsrc expressions approximating each meme's silhouette. Written
// without commas (mod() is expanded by hand) so they drop into a lavfi graph
// with no quoting games.
const DEFAULT_SYNTH: Record<SfxSoundId, { expr: string; durationSec: number }> = {
  // Deep 808-style boom with a fast pitch drop.
  vineBoom: { expr: "0.95*exp(-3.5*t)*sin(2*PI*(50+110*exp(-9*t))*t)", durationSec: 1.4 },
  // Short brassy stab — stacked harmonics on a Bb.
  fa: { expr: "0.9*exp(-7*t)*(sin(2*PI*466*t)+0.5*sin(2*PI*932*t)+0.3*sin(2*PI*1397*t))", durationSec: 0.5 },
  // Repeating woody thumps every ~185 ms — the role-reveal rhythm.
  amongUs: { expr: "0.9*exp(-22*(t-0.185*floor(t/0.185)))*sin(2*PI*95*t)", durationSec: 1.15 }
};

function extFromName(fileName: string, mime: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (/^\.(mp3|m4a|aac|wav|ogg|flac|opus|webm)$/.test(fromName)) return fromName;
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return ".m4a";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("flac")) return ".flac";
  return ".mp3";
}

async function readIndex(): Promise<SfxIndex> {
  try {
    return JSON.parse(await readFile(indexFile, "utf8")) as SfxIndex;
  } catch {
    return {};
  }
}

async function writeIndex(index: SfxIndex) {
  const write = async () => {
    await mkdir(sfxRoot, { recursive: true });
    const tmpPath = `${indexFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(index, null, 2), "utf8");
    try {
      await rename(tmpPath, indexFile);
    } catch {
      await writeFile(indexFile, JSON.stringify(index, null, 2), "utf8");
      await unlink(tmpPath).catch(() => undefined);
    }
  };
  indexQueue = indexQueue.then(write, write);
  await indexQueue;
}

function customDir(soundId: SfxSoundId) {
  return path.join(sfxRoot, "custom", soundId);
}

function customFilePath(soundId: SfxSoundId, sound: SfxCustomSound) {
  return path.join(customDir(soundId), sound.storedName);
}

function defaultFilePath(soundId: SfxSoundId) {
  return path.join(sfxRoot, "defaults", `${soundId}.wav`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export { isSfxSoundId };

export async function getSoundStatus(): Promise<SfxSoundStatus[]> {
  const index = await readIndex();
  return SFX_SOUND_IDS.map((id) => ({ id, custom: index[id] ?? null }));
}

export async function getCustomSound(soundId: SfxSoundId): Promise<SfxCustomSound | null> {
  const index = await readIndex();
  return index[soundId] ?? null;
}

/**
 * Streams an uploaded replacement sound to disk for one slot. A dropped video
 * has its audio extracted (same convenience as the music library); a previous
 * upload for the slot is replaced.
 */
export async function saveCustomSound(
  soundId: SfxSoundId,
  body: ReadableStream<Uint8Array>,
  fileName: string,
  mime: string
): Promise<SfxCustomSound> {
  const dir = customDir(soundId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const uploadExt = path.extname(fileName).toLowerCase() || extFromName(fileName, mime);
  const uploadPath = path.join(dir, `upload${uploadExt}`);
  await pipeline(
    Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(uploadPath)
  );

  let sourcePath: string;
  let storedName: string;
  let outName = fileName;
  let outMime = mime || "audio/mpeg";

  if (await hasVideoStream(uploadPath)) {
    if (!(await hasAudioStream(uploadPath))) {
      await rm(dir, { recursive: true, force: true });
      throw new Error("That video has no audio to extract.");
    }
    storedName = "sound.mp3";
    sourcePath = path.join(dir, storedName);
    await runFfmpeg(["-hide_banner", "-y", "-i", uploadPath, "-vn", "-c:a", "libmp3lame", "-q:a", "2", sourcePath]);
    await rm(uploadPath, { force: true });
    outMime = "audio/mpeg";
    outName = `${fileName.replace(/\.[^./\\]+$/, "")}.mp3`;
  } else {
    storedName = `sound${extFromName(fileName, mime)}`;
    sourcePath = path.join(dir, storedName);
    if (sourcePath !== uploadPath) await rename(uploadPath, sourcePath);
  }

  const { size } = await stat(sourcePath);
  const durationSec = await probeDuration(sourcePath).catch(() => 0);
  const sound: SfxCustomSound = {
    fileName: outName,
    storedName,
    mime: outMime,
    sizeBytes: size,
    durationSec,
    updatedAt: new Date().toISOString()
  };
  const index = await readIndex();
  index[soundId] = sound;
  await writeIndex(index);
  return sound;
}

/** Removes the uploaded replacement so the slot falls back to its stand-in. */
export async function deleteCustomSound(soundId: SfxSoundId) {
  const index = await readIndex();
  delete index[soundId];
  await writeIndex(index);
  await rm(customDir(soundId), { recursive: true, force: true });
}

/** Synthesizes the stand-in for a slot on first use; cached on disk after. */
async function ensureDefaultSound(soundId: SfxSoundId): Promise<string> {
  const outPath = defaultFilePath(soundId);
  if (await fileExists(outPath)) return outPath;
  await mkdir(path.dirname(outPath), { recursive: true });
  const { expr, durationSec } = DEFAULT_SYNTH[soundId];
  const tmpPath = `${outPath}.${process.pid}.tmp.wav`;
  await runFfmpeg([
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${expr}:s=48000:d=${durationSec}`,
    "-ac",
    "2",
    tmpPath
  ]);
  try {
    await rename(tmpPath, outPath);
  } catch {
    await rm(tmpPath, { force: true });
  }
  return outPath;
}

/**
 * The file the mixer should play for a slot: the uploaded replacement when
 * present, the synthesized stand-in otherwise. Returns null only when even
 * the stand-in could not be produced (e.g. ffmpeg missing).
 */
export async function resolveSoundPath(soundId: SfxSoundId): Promise<string | null> {
  const custom = await getCustomSound(soundId);
  if (custom) {
    const customPath = customFilePath(soundId, custom);
    if (await fileExists(customPath)) return customPath;
  }
  try {
    return await ensureDefaultSound(soundId);
  } catch {
    return null;
  }
}

export function openSoundRange(filePath: string, start: number, end: number): ReadStream {
  return createReadStream(filePath, { start, end });
}
