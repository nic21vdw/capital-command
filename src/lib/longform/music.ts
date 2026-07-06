import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { probeDuration } from "@/lib/clipping/ffmpeg";
import type { MusicTrack } from "@/lib/longform/types";

// The shared background-music library: songs uploaded once and reusable
// across every long-form project. Files live on disk next to a small JSON
// index — the same storage shape as the clips sources.

const musicRoot = path.join(process.cwd(), "data", "longform", "music");
const libraryFile = path.join(musicRoot, "library.json");
let libraryQueue = Promise.resolve();

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

async function readLibrary(): Promise<MusicTrack[]> {
  try {
    return JSON.parse(await readFile(libraryFile, "utf8")) as MusicTrack[];
  } catch {
    return [];
  }
}

async function writeLibrary(tracks: MusicTrack[]) {
  const write = async () => {
    await mkdir(musicRoot, { recursive: true });
    const tmpPath = `${libraryFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(tracks, null, 2), "utf8");
    try {
      await rename(tmpPath, libraryFile);
    } catch {
      await writeFile(libraryFile, JSON.stringify(tracks, null, 2), "utf8");
      await unlink(tmpPath).catch(() => undefined);
    }
  };
  libraryQueue = libraryQueue.then(write, write);
  await libraryQueue;
}

export async function listTracks(): Promise<MusicTrack[]> {
  const tracks = await readLibrary();
  return tracks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTrack(id: string): Promise<MusicTrack | null> {
  const tracks = await readLibrary();
  return tracks.find((track) => track.id === id) ?? null;
}

export function trackDir(id: string) {
  return path.join(musicRoot, id);
}

export function trackFilePath(track: MusicTrack) {
  return path.join(trackDir(track.id), track.storedName);
}

/** Streams an uploaded song straight to disk and registers it in the library. */
export async function saveTrackFromStream(
  body: ReadableStream<Uint8Array>,
  fileName: string,
  mime: string
): Promise<MusicTrack> {
  const id = crypto.randomUUID().slice(0, 12);
  const storedName = `track${extFromName(fileName, mime)}`;
  const dir = trackDir(id);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, storedName);
  await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(dest));

  const { size } = await stat(dest);
  const durationSec = await probeDuration(dest).catch(() => 0);
  const track: MusicTrack = {
    id,
    fileName,
    storedName,
    mime: mime || "audio/mpeg",
    sizeBytes: size,
    durationSec,
    createdAt: new Date().toISOString()
  };
  const tracks = await readLibrary();
  tracks.push(track);
  await writeLibrary(tracks);
  return track;
}

export async function deleteTrack(id: string) {
  const tracks = await readLibrary();
  await writeLibrary(tracks.filter((track) => track.id !== id));
  await rm(trackDir(id), { recursive: true, force: true });
}

export function openTrackRange(track: MusicTrack, start: number, end: number): ReadStream {
  return createReadStream(trackFilePath(track), { start, end });
}
