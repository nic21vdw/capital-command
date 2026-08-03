import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { transcribeMedia, type TranscribeOptions } from "@/lib/clipping/whisper";
import { dataPath } from "@/lib/paths";
import type { CaptionSegment } from "@/types/domain";

/**
 * One whole-recording transcript per shared source.
 *
 * The Stream Pipeline points the long-form project and the clip job at the SAME
 * source id, and both want the same words. Without this they each ran Whisper
 * over identical audio, concurrently — the single most expensive thing a run
 * does, doubled. The first caller transcribes, later callers (including a
 * caller in a later request, or after a restart) read the cache.
 *
 * Partial transcripts never touch the cache: a long source only has its opening
 * minutes transcribed for the hook, and serving that as the whole recording is
 * exactly the bug the topic planner's coverage check exists to catch.
 */

const sourcesRoot = dataPath("clips", "sources");

type TranscriptGlobal = typeof globalThis & { __sourceTranscripts?: Map<string, Promise<CaptionSegment[]>> };
const g = globalThis as TranscriptGlobal;
const inflight = (g.__sourceTranscripts ??= new Map<string, Promise<CaptionSegment[]>>());

function cacheFile(sourceId: string) {
  return path.join(sourcesRoot, sourceId, "transcript.json");
}

export async function readSourceTranscript(sourceId: string): Promise<CaptionSegment[] | null> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile(sourceId), "utf8")) as CaptionSegment[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSourceTranscript(sourceId: string, segments: CaptionSegment[]) {
  const file = cacheFile(sourceId);
  const payload = JSON.stringify(segments);
  await mkdir(path.dirname(file), { recursive: true });
  const tmpPath = `${file}.${process.pid}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  try {
    await rename(tmpPath, file);
  } catch {
    await writeFile(file, payload, "utf8");
    await unlink(tmpPath).catch(() => undefined);
  }
}

export async function transcribeSource(
  sourceId: string | undefined,
  mediaPath: string,
  workDir: string,
  options: TranscribeOptions = {}
): Promise<CaptionSegment[]> {
  if (!sourceId || options.maxSeconds) return transcribeMedia(mediaPath, workDir, options);

  const cached = await readSourceTranscript(sourceId);
  if (cached) return cached;

  const running = inflight.get(sourceId);
  if (running) return running;

  const work = (async () => {
    const segments = await transcribeMedia(mediaPath, workDir, options);
    if (segments.length > 0) await writeSourceTranscript(sourceId, segments);
    return segments;
  })();
  inflight.set(sourceId, work);
  try {
    return await work;
  } finally {
    inflight.delete(sourceId);
  }
}
