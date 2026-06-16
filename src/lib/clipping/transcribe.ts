import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import type { TranscriptSegment } from "@/lib/clipping/types";

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
// 16 kHz mono MP3 at ~48 kbps is ~6 KB/s, so 20-minute chunks stay well under
// Whisper's 25 MB limit while keeping the number of API calls small.
const CHUNK_SECONDS = 1200;

export function transcriptionConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Sends one audio file to Whisper and returns its (chunk-local) segments. */
async function transcribeFile(audioPath: string, apiKey: string): Promise<TranscriptSegment[]> {
  const audio = await readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), path.basename(audioPath));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = response.status === 401 ? "the OPENAI_API_KEY is invalid" : `Whisper returned ${response.status}`;
    throw new Error(`${detail}. ${body.slice(0, 200)}`);
  }

  const result = (await response.json()) as {
    segments?: Array<{ start: number; end: number; text: string }>;
  };
  return (result.segments ?? [])
    .map((seg) => ({ start: seg.start, end: seg.end, text: seg.text.trim() }))
    .filter((seg) => seg.text.length > 0);
}

/**
 * Transcribes the video's audio with OpenAI Whisper (the only external
 * service in the pipeline that handles audio). Long recordings are split into
 * time chunks so a 90-minute stream still clears Whisper's 25MB upload limit.
 * Returns null with a reason when transcription isn't possible, so the
 * pipeline can continue without it.
 */
export async function transcribe(
  inputPath: string,
  workDir: string
): Promise<{ segments: TranscriptSegment[] } | { segments: null; reason: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      segments: null,
      reason: "Transcription skipped: set OPENAI_API_KEY in .env to enable Whisper transcription and burned/exported captions."
    };
  }

  const audioPath = path.join(workDir, "audio.mp3");
  await runFfmpeg(["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audioPath]);
  const cleanup: string[] = [audioPath];

  try {
    const { size } = await stat(audioPath);

    // Small enough to send in a single request.
    if (size <= WHISPER_MAX_BYTES) {
      return { segments: await transcribeFile(audioPath, apiKey) };
    }

    // Otherwise split into fixed-length chunks and stitch the timestamps back.
    const chunkPattern = path.join(workDir, "chunk-%03d.mp3");
    await runFfmpeg([
      "-y",
      "-i",
      audioPath,
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-c",
      "copy",
      chunkPattern
    ]);

    const chunkFiles = (await readdir(workDir))
      .filter((name) => /^chunk-\d{3}\.mp3$/.test(name))
      .sort();
    if (chunkFiles.length === 0) {
      return { segments: null, reason: "Transcription failed: could not split the audio into chunks." };
    }

    const segments: TranscriptSegment[] = [];
    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkPath = path.join(workDir, chunkFiles[i]);
      cleanup.push(chunkPath);
      const offset = i * CHUNK_SECONDS;
      const chunkSegments = await transcribeFile(chunkPath, apiKey);
      for (const seg of chunkSegments) {
        segments.push({ start: seg.start + offset, end: seg.end + offset, text: seg.text });
      }
    }
    return { segments };
  } catch (error) {
    return {
      segments: null,
      reason: `Transcription failed: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    for (const file of cleanup) await unlink(file).catch(() => undefined);
  }
}

function toSrtTime(seconds: number) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped % 1) * 1000);
  const pad = (value: number, len = 2) => String(value).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** Builds SRT content for the transcript segments inside [start, end]. */
export function buildSrtForRange(segments: TranscriptSegment[], start: number, end: number): string | null {
  const inRange = segments.filter((seg) => seg.end > start && seg.start < end);
  if (inRange.length === 0) return null;
  return (
    inRange
      .map((seg, index) => {
        const from = Math.max(0, seg.start - start);
        const to = Math.max(from + 0.2, Math.min(end - start, seg.end - start));
        return `${index + 1}\n${toSrtTime(from)} --> ${toSrtTime(to)}\n${seg.text}`;
      })
      .join("\n\n") + "\n"
  );
}

/** Plain-text excerpt of the transcript inside [start, end]. */
export function excerptForRange(segments: TranscriptSegment[], start: number, end: number, maxChars = 1200) {
  const text = segments
    .filter((seg) => seg.end > start && seg.start < end)
    .map((seg) => seg.text)
    .join(" ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
