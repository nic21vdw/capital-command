import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chunkWords } from "@/lib/clipping/captions";
import { probeDuration, RenderCanceledError, runFfmpeg } from "@/lib/clipping/ffmpeg";
import type { CaptionSegment, CaptionWord } from "@/types/domain";

/**
 * Local speech-to-text for uploaded videos.
 *
 * Uploads have no platform captions to pull, so we transcribe them ourselves
 * with Whisper running fully on-device via @huggingface/transformers (ONNX,
 * no API key, no audio leaves the machine). The model is downloaded once on
 * first use and cached under data/clips/bin/whisper-models.
 *
 * Word-level timestamps come straight from the model, which is what powers
 * the editor's word-synced captions for uploaded files.
 */

const DEFAULT_MODEL = "Xenova/whisper-base.en";
const MODEL_CACHE_DIR = path.join(process.cwd(), "data", "clips", "bin", "whisper-models");

function modelId(): string {
  return process.env.CLIPS_WHISPER_MODEL?.trim() || DEFAULT_MODEL;
}

export type WordChunk = { text: string; timestamp: [number, number | null] };
type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>
) => Promise<{ text: string; chunks?: WordChunk[] }>;

// The pipeline is expensive to build (loads ~150 MB of weights), so it is
// created once and shared. globalThis survives Next dev's per-route module
// graphs, mirroring how job state is stored.
type WhisperGlobal = typeof globalThis & { __whisperPipeline?: Promise<Transcriber>; __whisperModelId?: string };
const g = globalThis as WhisperGlobal;

async function getTranscriber(): Promise<Transcriber> {
  const id = modelId();
  if (!g.__whisperPipeline || g.__whisperModelId !== id) {
    g.__whisperModelId = id;
    g.__whisperPipeline = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      await mkdir(MODEL_CACHE_DIR, { recursive: true });
      env.cacheDir = MODEL_CACHE_DIR;
      const transcriber = await pipeline("automatic-speech-recognition", id, { dtype: "q8" });
      return transcriber as unknown as Transcriber;
    })();
    // A failed load (offline, bad model id) must not poison later attempts.
    g.__whisperPipeline.catch(() => {
      if (g.__whisperModelId === id) {
        g.__whisperPipeline = undefined;
        g.__whisperModelId = undefined;
      }
    });
  }
  return g.__whisperPipeline;
}

const PCM_RATE = 16000;

/**
 * Decodes a window of any audio/video file into the 16 kHz mono float PCM
 * Whisper expects. `startSec`/`durationSec` bound the decode so long
 * recordings never have to fit in memory as one array.
 */
async function decodePcm(
  mediaPath: string,
  workDir: string,
  window: { startSec?: number; durationSec?: number } = {},
  signal?: AbortSignal
): Promise<Float32Array> {
  await mkdir(workDir, { recursive: true });
  const pcmPath = path.join(workDir, `whisper-${Date.now()}.pcm`);
  try {
    const args = ["-y"];
    if (window.startSec) args.push("-ss", window.startSec.toFixed(3));
    args.push("-i", mediaPath, "-vn", "-ac", "1", "-ar", String(PCM_RATE));
    if (window.durationSec) args.push("-t", window.durationSec.toFixed(3));
    args.push("-f", "f32le", "-acodec", "pcm_f32le", pcmPath);
    await runFfmpeg(args, { signal });
    const buffer = await readFile(pcmPath);
    return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  } finally {
    await rm(pcmPath, { force: true }).catch(() => undefined);
  }
}

// A word without a model-provided end is held on screen for this long (or until
// the next word starts, whichever comes first).
const DEFAULT_WORD_SEC = 0.24;

// Forward-spike repair (see wordsFromChunks): a start is treated as a bogus
// hallucination stamp when at least half of the next few words start more than
// the tolerance *before* it — words arrive in spoken order, so real timestamps
// can never run ahead of the words that follow.
const SPIKE_LOOKAHEAD = 5;
const SPIKE_TOLERANCE_SEC = 1;

export function wordsFromChunks(chunks: WordChunk[]): CaptionWord[] {
  type Entry = { text: string; start: number | null; end: number | null };
  const entries: Entry[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    const rawStart = chunk.timestamp?.[0];
    const rawEnd = chunk.timestamp?.[1];
    entries.push({
      text,
      start: rawStart != null && Number.isFinite(rawStart) ? rawStart : null,
      end: rawEnd != null && Number.isFinite(rawEnd) ? rawEnd : null
    });
  }

  // Whisper stamps hallucinated words (typically emitted during silence) at
  // the far edge of their 30s decode chunk — tens of seconds ahead of the
  // surrounding speech. The monotonic clamp below trusts spoken order, so a
  // single spiked start would ratchet every later word forward past it and
  // captions would run late from that word on; silence-heavy long recordings
  // spike repeatedly, so the desync keeps growing as the video plays. A start
  // that sits clearly ahead of the words spoken after it cannot be real —
  // drop the stamp so the word inherits the previous word's end instead.
  const rawStarts = entries.map((entry) => entry.start);
  for (let i = 0; i < entries.length; i++) {
    const start = rawStarts[i];
    if (start === null) continue;
    const ahead: number[] = [];
    for (let j = i + 1; j < entries.length && ahead.length < SPIKE_LOOKAHEAD; j++) {
      const next = rawStarts[j];
      if (next !== null) ahead.push(next);
    }
    // With fewer than two later stamps there is no reliable majority to vote
    // with — leave the tail untouched rather than guess.
    if (ahead.length < 2) continue;
    const earlier = ahead.filter((next) => next < start - SPIKE_TOLERANCE_SEC).length;
    if (earlier * 2 >= ahead.length) {
      entries[i].start = null;
      entries[i].end = null; // both halves of the stamp came from the same bogus alignment
    }
  }

  const words: CaptionWord[] = [];
  for (const entry of entries) {
    const prev = words[words.length - 1];
    // Timestamps must stay monotonic in spoken order. Whisper occasionally emits
    // a word whose raw start sits *before* the previous word at a 30s chunk
    // boundary; trust the transcript order and clamp forward rather than sorting
    // by start (which would silently reorder the words and scramble the text).
    let start = entry.start ?? prev?.end ?? 0;
    start = Math.max(0, start, prev?.start ?? 0);

    let end = entry.end ?? start + DEFAULT_WORD_SEC;
    end = Math.max(end, start + 0.02);

    // Close the previous word against this one. Without this, an inflated model
    // end (or the fallback duration) can run past the next word, which later
    // makes a whole phrase overlap the following one — the caption then looks
    // "frozen" on the old line while the new words show nothing.
    if (prev && prev.end > start) prev.end = start;

    words.push({ text: entry.text, start, end });
  }
  return words;
}

// Long recordings are decoded and transcribed in windows this long. 10 minutes
// of 16 kHz f32 PCM is ~38 MB — bounded no matter how long the source is; a
// single-array decode of a multi-hour stream (~230 MB/hour) would OOM.
const DECODE_WINDOW_SEC = 600;

/** Shifts model word timestamps from window-relative to source-relative time. */
export function offsetWordChunks(chunks: WordChunk[], offsetSec: number): WordChunk[] {
  if (offsetSec === 0) return chunks;
  return chunks.map((chunk) => ({
    text: chunk.text,
    timestamp: [
      (chunk.timestamp?.[0] ?? 0) + offsetSec,
      chunk.timestamp?.[1] == null ? null : chunk.timestamp[1] + offsetSec
    ]
  }));
}

export type TranscribeOptions = {
  /**
   * Transcribe only the opening this-many seconds. Used by callers that only
   * need the start of a long recording (the Long-Form hook covers at most the
   * first 60s) so a multi-hour stream doesn't spend hours in Whisper.
   */
  maxSeconds?: number;
  /** Stops FFmpeg decoding immediately and prevents later Whisper windows from starting. */
  signal?: AbortSignal;
};

/**
 * Transcribes a media file (video or audio) into caption segments with
 * word-level timing. Throws with an actionable message when transcription
 * is unavailable so callers can surface it as a job notice.
 */
export async function transcribeMedia(
  mediaPath: string,
  workDir: string,
  options: TranscribeOptions = {}
): Promise<CaptionSegment[]> {
  if (options.signal?.aborted) throw new RenderCanceledError("Clip generation was stopped.");
  let transcriber: Transcriber;
  try {
    transcriber = await getTranscriber();
  } catch (error) {
    throw new Error(
      `The local transcription model could not be loaded (${error instanceof Error ? error.message.slice(0, 160) : String(error)}). ` +
        "The first run needs internet access to download the Whisper model; captions can still be added manually in the editor."
    );
  }

  const transcribe = (audio: Float32Array) =>
    transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: "word"
    });

  // The window plan needs the media duration; when the probe fails, fall back
  // to a single whole-file decode (short/odd files, exactly the old behavior).
  let totalSec: number | null = null;
  try {
    totalSec = await probeDuration(mediaPath);
  } catch {
    totalSec = null;
  }
  const capSec = options.maxSeconds && options.maxSeconds > 0 ? options.maxSeconds : null;
  const targetSec = totalSec === null ? capSec : capSec === null ? totalSec : Math.min(totalSec, capSec);

  const allChunks: WordChunk[] = [];
  let decodedSamples = 0;
  if (targetSec !== null && targetSec > DECODE_WINDOW_SEC) {
    for (let offset = 0; offset < targetSec; offset += DECODE_WINDOW_SEC) {
      const windowSec = Math.min(DECODE_WINDOW_SEC, targetSec - offset);
      if (options.signal?.aborted) throw new RenderCanceledError("Clip generation was stopped.");
      const audio = await decodePcm(mediaPath, workDir, { startSec: offset, durationSec: windowSec }, options.signal);
      decodedSamples += audio.length;
      if (audio.length >= PCM_RATE * 0.25) {
        const result = await transcribe(audio);
        if (options.signal?.aborted) throw new RenderCanceledError("Clip generation was stopped.");
        allChunks.push(...offsetWordChunks(result.chunks ?? [], offset));
      }
      // The probed duration can overshoot the real audio (VBR headers); a
      // short decode means the stream actually ended inside this window.
      if (audio.length < (windowSec - 1) * PCM_RATE) break;
    }
  } else {
    const audio = await decodePcm(
      mediaPath,
      workDir,
      targetSec !== null ? { durationSec: targetSec } : {},
      options.signal
    );
    decodedSamples = audio.length;
    if (audio.length >= PCM_RATE * 0.25) {
      const result = await transcribe(audio);
      if (options.signal?.aborted) throw new RenderCanceledError("Clip generation was stopped.");
      allChunks.push(...(result.chunks ?? []));
    }
  }

  if (decodedSamples < PCM_RATE * 0.5) {
    throw new Error("The audio track is too short to transcribe.");
  }
  const words = wordsFromChunks(allChunks);
  if (words.length === 0) {
    throw new Error("No speech was detected in this video. You can still add caption segments manually in the editor.");
  }
  return chunkWords(words);
}
