import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import type { TranscriptSegment } from "@/lib/clipping/types";

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export function transcriptionConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Transcribes the video's audio with OpenAI Whisper (the only external
 * service in the pipeline that handles audio). Returns null with a reason
 * when transcription isn't possible, so the pipeline can continue without it.
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

  try {
    const { size } = await stat(audioPath);
    if (size > WHISPER_MAX_BYTES) {
      return {
        segments: null,
        reason: "Transcription skipped: the extracted audio exceeds Whisper's 25MB upload limit. Try a shorter video."
      };
    }

    const audio = await readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3");
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
      return { segments: null, reason: `Transcription failed: ${detail}. ${body.slice(0, 200)}` };
    }

    const result = (await response.json()) as {
      segments?: Array<{ start: number; end: number; text: string }>;
    };
    const segments = (result.segments ?? [])
      .map((seg) => ({ start: seg.start, end: seg.end, text: seg.text.trim() }))
      .filter((seg) => seg.text.length > 0);
    return { segments };
  } finally {
    await unlink(audioPath).catch(() => undefined);
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
