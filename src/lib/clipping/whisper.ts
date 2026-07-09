import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chunkWords } from "@/lib/clipping/captions";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { getLocalCacheRoot } from "@/lib/storage/data-root";
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
// Machine-local cache: model weights never travel with a cloud-synced workspace.
const MODEL_CACHE_DIR = path.join(getLocalCacheRoot(), "clips", "bin", "whisper-models");

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

/** Decodes any audio/video file into the 16 kHz mono float PCM Whisper expects. */
async function decodePcm(mediaPath: string, workDir: string): Promise<Float32Array> {
  await mkdir(workDir, { recursive: true });
  const pcmPath = path.join(workDir, `whisper-${Date.now()}.pcm`);
  try {
    await runFfmpeg([
      "-y",
      "-i",
      mediaPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      pcmPath
    ]);
    const buffer = await readFile(pcmPath);
    return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  } finally {
    await rm(pcmPath, { force: true }).catch(() => undefined);
  }
}

// A word without a model-provided end is held on screen for this long (or until
// the next word starts, whichever comes first).
const DEFAULT_WORD_SEC = 0.24;

export function wordsFromChunks(chunks: WordChunk[]): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    const prev = words[words.length - 1];
    // Timestamps must stay monotonic in spoken order. Whisper occasionally emits
    // a word whose raw start sits *before* the previous word at a 30s chunk
    // boundary; trust the transcript order and clamp forward rather than sorting
    // by start (which would silently reorder the words and scramble the text).
    let start = chunk.timestamp?.[0];
    if (start == null || !Number.isFinite(start)) start = prev?.end ?? 0;
    start = Math.max(0, start, prev?.start ?? 0);

    let end = chunk.timestamp?.[1];
    if (end == null || !Number.isFinite(end)) end = start + DEFAULT_WORD_SEC;
    end = Math.max(end, start + 0.02);

    // Close the previous word against this one. Without this, an inflated model
    // end (or the fallback duration) can run past the next word, which later
    // makes a whole phrase overlap the following one — the caption then looks
    // "frozen" on the old line while the new words show nothing.
    if (prev && prev.end > start) prev.end = start;

    words.push({ text, start, end });
  }
  return words;
}

/**
 * Transcribes a media file (video or audio) into caption segments with
 * word-level timing. Throws with an actionable message when transcription
 * is unavailable so callers can surface it as a job notice.
 */
export async function transcribeMedia(mediaPath: string, workDir: string): Promise<CaptionSegment[]> {
  let transcriber: Transcriber;
  try {
    transcriber = await getTranscriber();
  } catch (error) {
    throw new Error(
      `The local transcription model could not be loaded (${error instanceof Error ? error.message.slice(0, 160) : String(error)}). ` +
        "The first run needs internet access to download the Whisper model; captions can still be added manually in the editor."
    );
  }

  const audio = await decodePcm(mediaPath, workDir);
  if (audio.length < 16000 * 0.5) {
    throw new Error("The audio track is too short to transcribe.");
  }

  const result = await transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: "word"
  });

  const words = wordsFromChunks(result.chunks ?? []);
  if (words.length === 0) {
    throw new Error("No speech was detected in this video. You can still add caption segments manually in the editor.");
  }
  return chunkWords(words);
}
