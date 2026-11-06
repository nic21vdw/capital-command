import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chunkWords } from "@/lib/clipping/captions";
import { dataPath } from "@/lib/paths";
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
const MODEL_CACHE_DIR = dataPath("clips", "bin", "whisper-models");

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
type WhisperGlobal = typeof globalThis & {
  __whisperRunner?: Promise<ChunkRunner>;
  __whisperModelId?: string;
  __whisperWindowTail?: Promise<void>;
};
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
async function startWorkerRunner(id: string, invalidate: () => void): Promise<ChunkRunner | null> {
  try {
    const { Worker } = await import("node:worker_threads");
    const worker = new Worker(workerPath, { workerData: { modelId: id, cacheDir: MODEL_CACHE_DIR } });
    const pending = new Map<number, { resolve: (chunks: WordChunk[]) => void; reject: (error: Error) => void }>();
    let seq = 0;
    let runnerReady = false;
    let workerFailure: Error | undefined;

    const fail = (error: Error) => {
      workerFailure = error;
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      // Startup failure falls back within the same cached loading promise.
      // Only a runner that was handed out can invalidate that cache.
      if (runnerReady) invalidate();
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

    let ready: { ready: boolean; error?: string };
    try {
      ready = await new Promise<{ ready: boolean; error?: string }>((resolve, reject) => {
        const cleanup = () => {
          worker.off("message", onReady);
          worker.off("error", onError);
          worker.off("exit", onExit);
        };
        const onReady = (message: { ready?: boolean; error?: string }) => {
          if (typeof message.ready !== "boolean") return;
          cleanup();
          resolve({ ready: message.ready, error: message.error });
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onExit = () => onError(new Error("The transcription worker stopped before it was ready."));
        worker.on("message", onReady);
        worker.on("error", onError);
        worker.on("exit", onExit);
      });
    } catch {
      await worker.terminate().catch(() => undefined);
      return null;
    }
    if (!ready.ready || workerFailure) {
      await worker.terminate().catch(() => undefined);
      return null;
    }
    runnerReady = true;

    return (audio) => {
      // The worker can stop while FFmpeg is still decoding this window.
      if (workerFailure) return Promise.reject(workerFailure);
      const messageId = (seq += 1);
      // The buffer is transferred, so hand the worker a copy the caller no
      // longer needs rather than detaching the caller's own array.
      const copy = audio.slice();
      return new Promise<WordChunk[]>((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        try {
          worker.postMessage({ id: messageId, pcm: copy.buffer }, [copy.buffer]);
        } catch (error) {
          pending.delete(messageId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
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
    const loading: Promise<ChunkRunner> = (async () =>
      (await startWorkerRunner(id, () => {
        // An old worker may exit after a replacement of the same model starts.
        if (g.__whisperRunner === loading) {
          g.__whisperRunner = undefined;
          g.__whisperModelId = undefined;
        }
      })) ?? (await inProcessRunner(id)))();
    g.__whisperRunner = loading;
    // A failed load (offline, bad model id) must not poison later attempts.
    loading.catch(() => {
      if (g.__whisperRunner === loading) {
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
  const pcmPath = path.join(workDir, `whisper-${randomUUID()}.pcm`);
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
 * Shares one decode/inference slot across Next's module graphs. Queued windows
 * retain only paths, not PCM/tensors. Releasing after each window lets another
 * recording make progress between windows of a multi-hour source.
 */
async function transcribeWindow(
  mediaPath: string,
  workDir: string,
  startSec: number,
  durationSec: number
): Promise<{ chunks: WordChunk[]; sampleCount: number }> {
  const previous = g.__whisperWindowTail ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  g.__whisperWindowTail = current;
  await previous;
  try {
    let transcribe: ChunkRunner;
    try {
      transcribe = await getRunner();
    } catch (error) {
      throw new Error(
        `The local transcription model could not be loaded (${error instanceof Error ? error.message.slice(0, 160) : String(error)}). ` +
          "The first run needs internet access to download the Whisper model; captions can still be added manually in the editor."
      );
    }
    const audio = await decodePcm(mediaPath, workDir, { startSec, durationSec });
    const sampleCount = audio.length;
    const chunks = sampleCount >= PCM_RATE * 0.25 ? await transcribe(audio) : [];
    return { chunks, sampleCount };
  } finally {
    release();
    if (g.__whisperWindowTail === current) g.__whisperWindowTail = undefined;
  }
}

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
  // Duration is only an upper bound. If probing fails, keep decoding bounded
  // windows until EOF instead of allocating an entire multi-hour recording.
  let totalSec: number | null = null;
  try {
    const duration = await probeDuration(mediaPath);
    if (Number.isFinite(duration) && duration > 0) totalSec = duration;
  } catch {
    totalSec = null;
  }
  const capSec =
    options.maxSeconds !== undefined && Number.isFinite(options.maxSeconds) && options.maxSeconds > 0
      ? options.maxSeconds
      : null;
  const targetSec = totalSec === null ? capSec : capSec === null ? totalSec : Math.min(totalSec, capSec);

  const allChunks: WordChunk[] = [];
  let decodedSamples = 0;
  for (let offset = 0; targetSec === null || offset < targetSec; offset += DECODE_WINDOW_SEC) {
    const windowSec = targetSec === null ? DECODE_WINDOW_SEC : Math.min(DECODE_WINDOW_SEC, targetSec - offset);
    const { chunks, sampleCount } = await transcribeWindow(mediaPath, workDir, offset, windowSec);
    decodedSamples += sampleCount;
    allChunks.push(...offsetWordChunks(chunks, offset));
    // A short decode means EOF, even when VBR headers overstate the duration.
    if (sampleCount < (windowSec - 1) * PCM_RATE) break;
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
