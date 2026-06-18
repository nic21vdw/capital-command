import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hasAudioStream, probeDuration, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";

// Sources live under data/clips/sources/<id>/ — the source file is stored once
// and referenced by any number of projects, so large videos are never copied.
const sourcesRoot = path.join(process.cwd(), "data", "clips", "sources");

export type SourceMeta = {
  id: string;
  fileName: string;
  storedName: string;
  mime: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  createdAt: string;
};

export function sourceDir(id: string) {
  return path.join(sourcesRoot, id);
}

function metaPath(id: string) {
  return path.join(sourceDir(id), "meta.json");
}

export async function readSourceMeta(id: string): Promise<SourceMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8")) as SourceMeta;
  } catch {
    return null;
  }
}

async function writeSourceMeta(meta: SourceMeta) {
  await writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), "utf8");
}

export function sourceFilePath(meta: SourceMeta) {
  return path.join(sourceDir(meta.id), meta.storedName);
}

function extFromName(name: string, mime: string) {
  const fromName = path.extname(name).toLowerCase();
  if (fromName && fromName.length <= 6) return fromName;
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return ".mov";
  if (mime.includes("matroska")) return ".mkv";
  return ".mp4";
}

/** Parse the first video stream's pixel dimensions from `ffmpeg -i` output. */
function parseDimensions(stderr: string): { width: number; height: number } {
  const match = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Streams an incoming request body straight to disk (never buffering the whole
 * file in memory), then probes metadata. Safe for ~90-minute uploads.
 */
export async function saveSourceFromStream(
  body: ReadableStream<Uint8Array>,
  fileName: string,
  mime: string
): Promise<SourceMeta> {
  const id = crypto.randomUUID().slice(0, 12);
  await mkdir(sourceDir(id), { recursive: true });
  const storedName = `source${extFromName(fileName, mime)}`;
  const dest = path.join(sourceDir(id), storedName);

  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));

  const sizeBytes = (await stat(dest)).size;

  // Probe is best-effort: if ffmpeg can't read it, the client still fills in
  // duration/dimensions from the <video> element on load.
  let durationSec = 0;
  let width = 0;
  let height = 0;
  let hasAudio = true;
  if (resolveFfmpeg()) {
    try {
      const { stderr } = await runFfmpeg(["-hide_banner", "-i", dest], { allowFailure: true });
      const dims = parseDimensions(stderr);
      width = dims.width;
      height = dims.height;
      try {
        durationSec = await probeDuration(dest);
      } catch {
        durationSec = 0;
      }
      hasAudio = await hasAudioStream(dest);
    } catch {
      // leave defaults
    }
  }

  const meta: SourceMeta = {
    id,
    fileName,
    storedName,
    mime: mime || "video/mp4",
    sizeBytes,
    durationSec: Math.round(durationSec * 1000) / 1000,
    width,
    height,
    hasAudio,
    createdAt: new Date().toISOString()
  };
  await writeSourceMeta(meta);
  return meta;
}

export async function deleteSource(id: string) {
  await rm(sourceDir(id), { recursive: true, force: true });
}

/** Open a (possibly partial) read stream for HTTP range responses. */
export function openSourceRange(meta: SourceMeta, start: number, end: number) {
  return createReadStream(sourceFilePath(meta), { start, end });
}

// --- Waveform peaks -------------------------------------------------------

const WAVEFORM_BUCKETS = 1600;

function waveformPath(id: string) {
  return path.join(sourceDir(id), "waveform.json");
}

/** Capture raw stdout bytes from ffmpeg (runFfmpeg coerces to string, which
 * corrupts binary PCM), used to compute waveform peaks. */
function ffmpegPcm(args: string[]): Promise<Buffer> {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error("ffmpeg unavailable"));
      return;
    }
    const child = spawn(bin, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) reject(new Error(`ffmpeg exited ${code}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Computes (and caches) a normalized 0..1 peak array for the source audio.
 * Returns an empty array when there's no audio or ffmpeg is unavailable.
 */
export async function getWaveform(meta: SourceMeta): Promise<number[]> {
  try {
    const cached = JSON.parse(await readFile(waveformPath(meta.id), "utf8")) as number[];
    if (Array.isArray(cached)) return cached;
  } catch {
    // not cached yet
  }

  if (!meta.hasAudio || !resolveFfmpeg()) {
    await writeFile(waveformPath(meta.id), "[]", "utf8").catch(() => undefined);
    return [];
  }

  // Mono, low sample rate keeps even a 90-min stream to a few MB of PCM.
  const sampleRate = 200;
  const pcm = await ffmpegPcm([
    "-hide_banner",
    "-i",
    sourceFilePath(meta),
    "-ac",
    "1",
    "-ar",
    String(sampleRate),
    "-f",
    "s16le",
    "-"
  ]);

  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) return [];
  const bucketSize = Math.max(1, Math.floor(sampleCount / WAVEFORM_BUCKETS));
  const peaks: number[] = [];
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
    if (sample > peak) peak = sample;
    if ((i + 1) % bucketSize === 0) {
      peaks.push(Math.round(peak * 1000) / 1000);
      peak = 0;
    }
  }
  if (peak > 0) peaks.push(Math.round(peak * 1000) / 1000);

  await writeFile(waveformPath(meta.id), JSON.stringify(peaks), "utf8").catch(() => undefined);
  return peaks;
}
