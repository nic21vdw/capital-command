import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chunkWords } from "@/lib/clipping/captions";
import { probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
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

/** Turns one window of PCM into word chunks, wherever the model happens to run. */
type ChunkRunner = (audio: Float32Array) => Promise<WordChunk[]>;

const TRANSCRIBE_OPTIONS = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word" };

// The pipeline is expensive to build (loads ~150 MB of weights), so it is
// created once and shared. globalThis survives Next dev's per-route module
// graphs, mirroring how job state is stored.
type WhisperGlobal = typeof globalThis & { __whisperRunner?: Promise<ChunkRunner>; __whisperModelId?: string };
const g = globalThis as WhisperGlobal;

const workerPath = path.join(process.cwd(), "src", "lib", "clipping", "whisper-worker.mjs");

/**
 * ONNX inference is synchronous and pins the thread for as long as it runs — a
 * half-hour stream used to leave the whole Next server unable to answer a
 * request for fifteen minutes, so `/pipeline` rendered as an empty app while a
 * run was mid-flight. Off-thread is therefore the normal path; a machine where
 * the worker can't start (no worker file in a packaged build, a spawn failure)
 * falls back to the old in-process runner rather than losing transcription.
 */
async function startWorkerRunner(id: string): Promise<ChunkRunner | null> {
  try {
    const { Worker } = await import("node:worker_threads");
    const worker = new Worker(workerPath, { workerData: { modelId: id, cacheDir: MODEL_CACHE_DIR } });
    const pending = new Map<number, { resolve: (chunks: WordChunk[]) => void; reject: (error: Error) => void }>();
    let seq = 0;

    const fail = (error: Error) => {
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      if (g.__whisperModelId === id) {
        g.__whisperRunner = undefined;
        g.__whisperModelId = undefined;
      }
    };

    worker.on("message", (message: { id?: number; chunks?: WordChunk[]; error?: string }) => {
      if (message.id == null) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve(message.chunks ?? []);
    });
    worker.on("error", fail);
    worker.on("exit", () => fail(new Error("The transcription worker stopped before it answered.")));
    // The worker must never be what keeps a CLI process alive.
    worker.unref();

    const ready = await new Promise<{ ready: boolean; error?: string }>((resolve, reject) => {
      worker.once("message", (message: { ready: boolean; error?: string }) => resolve(message));
      worker.once("error", reject);
    });
    if (!ready.ready) {
      await worker.terminate();
      return null;
    }

    return (audio) => {
      const messageId = (seq += 1);
      // The buffer is transferred, so hand the worker a copy the caller no
      // longer needs rather than detaching the caller's own array.
      const copy = audio.slice();
      return new Promise<WordChunk[]>((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        worker.postMessage({ id: messageId, pcm: copy.buffer }, [copy.buffer]);
      });
    };
  } catch {
    return null;
  }
}

async function inProcessRunner(id: string): Promise<ChunkRunner> {
  const { env, pipeline } = await import("@huggingface/transformers");
  await mkdir(MODEL_CACHE_DIR, { recursive: true });
  env.cacheDir = MODEL_CACHE_DIR;
  const transcriber = (await pipeline("automatic-speech-recognition", id, { dtype: "q8" })) as unknown as Transcriber;
  return async (audio) => (await transcriber(audio, TRANSCRIBE_OPTIONS)).chunks ?? [];
}

async function getRunner(): Promise<ChunkRunner> {
  const id = modelId();
  if (!g.__whisperRunner || g.__whisperModelId !== id) {
    g.__whisperModelId = id;
    g.__whisperRunner = (async () => (await startWorkerRunner(id)) ?? (await inProcessRunner(id)))();
    // A failed load (offline, bad model id) must not poison later attempts.
    g.__whisperRunner.catch(() => {
      if (g.__whisperModelId === id) {
        g.__whisperRunner = undefined;
        g.__whisperModelId = undefined;
      }
    });
  }
  return g.__whisperRunner;
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
  window: { startSec?: number; durationSec?: number } = {}
): Promise<Float32Array> {
  await mkdir(workDir, { recursive: true });
  const pcmPath = path.join(workDir, `whisper-${Date.now()}.pcm`);
  try {
    const args = ["-y"];
    if (window.startSec) args.push("-ss", window.startSec.toFixed(3));
    args.push("-i", mediaPath, "-vn", "-ac", "1", "-ar", String(PCM_RATE));
    if (window.durationSec) args.push("-t", window.durationSec.toFixed(3));
    args.push("-f", "f32le", "-acodec", "pcm_f32le", pcmPath);
    await runFfmpeg(args);
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
    // The model splits hyphenated and contracted words into separate tokens
    // ("push", "-ups"), and every downstream consumer re-joins tokens with a
    // space — which burned "push -ups" into finished captions. A token that
    // opens with a hyphen or apostrophe is the tail of the word before it.
    const previous = entries[entries.length - 1];
    if (previous && /^[-']/.test(text)) {
      previous.text += text;
      if (rawEnd != null && Number.isFinite(rawEnd)) previous.end = rawEnd;
      continue;
    }
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

/** Share of identical caption lines above which a transcript reads as hallucinated. */
const DEGENERATE_REPEAT_SHARE = 0.4;

/**
 * Flags a transcript that is almost certainly not a transcript.
 *
 * The bundled model is `whisper-base.en` — English only. Fed Spanish, music, or
 * room noise it does not fail; it loops a single plausible English line, and
 * every downstream writer then treats that as what was said. Nothing else in
 * the pipeline can tell the difference, so catching the repetition here is what
 * stops a mistranscribed stream being published as if it were fine.
 */
export function transcriptQualityWarning(segments: CaptionSegment[]): string | null {
  const lines = segments.map((segment) => segment.text.trim().toLowerCase()).filter(Boolean);
  if (lines.length < 8) return null;
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  const commonest = Math.max(...counts.values());
  if (commonest / lines.length < DEGENERATE_REPEAT_SHARE) return null;
  return (
    "The transcript repeats the same line over and over, which usually means the audio was music, noise, or a " +
    "language the bundled English-only speech model cannot read. Captions, titles and posts written from it will " +
    "be wrong. Set CLIPS_WHISPER_MODEL to a multilingual Whisper model (for example Xenova/whisper-base) and run " +
    "the source again if it is not in English."
  );
}

/**
 * Drops words stamped past the end of the media and trims the one that
 * straddles it. A word may legitimately end a hair after the probed duration
 * (VBR headers round), so only clearly-past stamps are discarded.
 */
export function clampWordsToDuration(words: CaptionWord[], durationSec: number): CaptionWord[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return words;
  const limit = durationSec + 0.5;
  const kept: CaptionWord[] = [];
  for (const word of words) {
    if (word.start >= limit) continue;
    kept.push(word.end > limit ? { ...word, end: Math.max(word.start + 0.02, limit) } : word);
  }
  return kept;
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
  let transcribe: ChunkRunner;
  try {
    transcribe = await getRunner();
  } catch (error) {
    throw new Error(
      `The local transcription model could not be loaded (${error instanceof Error ? error.message.slice(0, 160) : String(error)}). ` +
        "The first run needs internet access to download the Whisper model; captions can still be added manually in the editor."
    );
  }

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
      const audio = await decodePcm(mediaPath, workDir, { startSec: offset, durationSec: windowSec });
      decodedSamples += audio.length;
      if (audio.length >= PCM_RATE * 0.25) {
        allChunks.push(...offsetWordChunks(await transcribe(audio), offset));
      }
      // The probed duration can overshoot the real audio (VBR headers); a
      // short decode means the stream actually ended inside this window.
      if (audio.length < (windowSec - 1) * PCM_RATE) break;
    }
  } else {
    const audio = await decodePcm(mediaPath, workDir, targetSec !== null ? { durationSec: targetSec } : {});
    decodedSamples = audio.length;
    if (audio.length >= PCM_RATE * 0.25) {
      allChunks.push(...(await transcribe(audio)));
    }
  }

  if (decodedSamples < PCM_RATE * 0.5) {
    throw new Error("The audio track is too short to transcribe.");
  }
  // Whisper stamps within its own 30s decode chunk, so the tail of a short
  // recording can be stamped past the end of the media — a 25s video came back
  // with a word at 29.9s, which then read as a "moment" nothing could show.
  const decodedSec = decodedSamples / PCM_RATE;
  const words = clampWordsToDuration(wordsFromChunks(allChunks), targetSec ?? decodedSec);
  if (words.length === 0) {
    throw new Error("No speech was detected in this video. You can still add caption segments manually in the editor.");
  }
  return chunkWords(words);
}
