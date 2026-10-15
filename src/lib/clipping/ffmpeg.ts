import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";

let cachedPath: string | null | undefined;

/**
 * Resolves an ffmpeg binary: the bundled ffmpeg-static build first, falling
 * back to whatever `ffmpeg` is on PATH. Returns null when neither exists.
 */
export function resolveFfmpeg(): string | null {
  if (cachedPath !== undefined) return cachedPath;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath) {
      accessSync(staticPath, constants.X_OK);
      cachedPath = staticPath;
      return cachedPath;
    }
  } catch {
    // fall through to PATH lookup
  }

  cachedPath = "ffmpeg";
  return cachedPath;
}

export const FFMPEG_MISSING_MESSAGE =
  "FFmpeg is not available. Run `npm install` (which bundles a static FFmpeg build) or install FFmpeg manually (Windows: `winget install ffmpeg`) and restart the app.";

/**
 * Thrown when a render is stopped on purpose (the user cancelled the export).
 * Callers use this to tell a deliberate stop apart from a real failure so the
 * export is marked "canceled" rather than "error".
 */
export class RenderCanceledError extends Error {
  constructor(message = "Render was stopped.") {
    super(message);
    this.name = "RenderCanceledError";
  }
}

/** Whether an error (or an aborted signal) represents a deliberate stop. */
export function isRenderCanceled(error: unknown): boolean {
  return error instanceof RenderCanceledError;
}

export type FfmpegResult = {
  stdout: string;
  stderr: string;
  code: number;
};

// Captures are diagnostic text, not media. Long-running analyzers stream their
// records through line callbacks instead of retaining the entire child output.
const MAX_CAPTURE_CHARS = 4 * 1024 * 1024;
const MAX_LINE_CHARS = 64 * 1024;

export type FfmpegOptions = {
  allowFailure?: boolean;
  onLine?: (line: string) => void;
  onStdoutLine?: (line: string) => void;
  /** Disable capture when stdout is consumed incrementally by onStdoutLine. */
  captureStdout?: boolean;
  signal?: AbortSignal;
};

/** Runs ffmpeg with bounded diagnostic buffers and optional streaming parsers. */
export function runFfmpeg(
  args: string[],
  { allowFailure = false, onLine, onStdoutLine, captureStdout = true, signal }: FfmpegOptions = {}
): Promise<FfmpegResult> {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error(FFMPEG_MISSING_MESSAGE));
      return;
    }
    if (signal?.aborted) {
      reject(new RenderCanceledError());
      return;
    }
    // No caller supplies interactive input. Closing stdin also prevents an
    // unattended child from waiting forever for an overwrite/console prompt.
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let stderrLineBuffer = "";
    let failure: Error | undefined;
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      try {
        child.kill("SIGKILL");
      } catch {
        /* process may have already exited */
      }
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const stopWithError = (error: unknown) => {
      // A parser is application code: its exception must reject this work,
      // never escape a stream event and bring down every other render.
      failure ??= error instanceof Error ? error : new Error(String(error));
      onAbort();
    };
    const lines = (pending: string, text: string, callback: (line: string) => void): string => {
      const parts = (pending + text).split(/[\r\n]/);
      const tail = parts.pop() ?? "";
      for (const part of parts) {
        if (part.length > MAX_LINE_CHARS) throw new Error("ffmpeg emitted an oversized diagnostic line.");
        if (part.trim()) callback(part.trim());
      }
      if (tail.length > MAX_LINE_CHARS) throw new Error("ffmpeg emitted an oversized diagnostic line.");
      return tail;
    };
    child.stdout?.on("data", (chunk) => {
      if (failure || settled) return;
      const text = String(chunk);
      try {
        if (captureStdout) {
          if (stdout.length + text.length > MAX_CAPTURE_CHARS) {
            throw new Error("ffmpeg stdout exceeded its capture limit; consume long output with onStdoutLine.");
          }
          stdout += text;
        }
        if (onStdoutLine) stdoutLineBuffer = lines(stdoutLineBuffer, text, onStdoutLine);
      } catch (error) {
        stopWithError(error);
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (failure || settled) return;
      const text = String(chunk);
      stderr += text;
      // Keep a diagnostic tail; analyzers that need every record use onLine.
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
      try {
        if (onLine) stderrLineBuffer = lines(stderrLineBuffer, text, onLine);
      } catch (error) {
        stopWithError(error);
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal?.aborted) reject(new RenderCanceledError());
      else if ((error as NodeJS.ErrnoException).code === "ENOENT") reject(new Error(FFMPEG_MISSING_MESSAGE));
      else reject(failure ?? error);
    });
    child.on("close", (code) => {
      if (settled) return;
      // Child streams may finish without a newline. Deliver the last complete
      // record too, unless parsing failed or this work was deliberately stopped.
      if (!failure && !signal?.aborted) {
        try {
          if (stdoutLineBuffer.trim()) onStdoutLine?.(stdoutLineBuffer.trim());
          if (stderrLineBuffer.trim()) onLine?.(stderrLineBuffer.trim());
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
        }
      }
      settled = true;
      cleanup();
      if (signal?.aborted) reject(new RenderCanceledError());
      else if (failure) reject(failure);
      else if (code !== 0 && !allowFailure) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
      } else resolve({ stdout, stderr, code: code ?? -1 });
    });
    // Install lifecycle/stream handlers before killing: an abort can happen
    // during spawn, before this listener exists. Recheck closes that race.
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** Reads the container duration (seconds) by parsing `ffmpeg -i` output. */
export async function probeDuration(inputPath: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true });
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error("Could not read the video duration — the file may be corrupt or not a video.");
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Reads the video frame size by parsing `ffmpeg -i` output. */
export async function probeDimensions(inputPath: string): Promise<{ width: number; height: number }> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true });
  const match = stderr.match(/Stream #\d+:\d+.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!match) {
    throw new Error("Could not read the video dimensions — the file may be corrupt or not a video.");
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Whether the file has at least one audio stream. */
export async function hasAudioStream(inputPath: string): Promise<boolean> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true });
  return /Stream #\d+:\d+.*Audio/.test(stderr);
}

/** Whether the file carries a video/picture stream (i.e. it's a video, not audio-only). */
export async function hasVideoStream(inputPath: string): Promise<boolean> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true });
  // Cover art in audio files shows up as an attached_pic video stream — ignore
  // those so an MP3 with embedded artwork isn't mistaken for a real video.
  return /Stream #\d+:\d+[^\n]*: Video:/.test(stderr) && !/attached pic/i.test(stderr);
}

export type VideoStreamInfo = {
  /** Display dimensions — rotation metadata already applied. */
  width: number;
  height: number;
  durationSec: number | null;
  /** Frames per second as the container reports it; absent when it says nothing. */
  fps?: number | null;
};

/** Parses `ffmpeg -i` stderr into display dimensions and duration. */
export function parseVideoStreamInfo(stderr: string): VideoStreamInfo | null {
  // Dimensions always follow a ", " on the Video stream line (codec fourcc
  // hex like "0x31637661" follows "/ ", so it can never match).
  const video = stderr.match(/Stream #\d+:\d+[^\n]*?: Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/);
  if (!video) return null;
  let width = Number(video[1]);
  let height = Number(video[2]);
  // Phone footage is often stored landscape with a rotation side channel that
  // players apply on display — honor it so 1920x1080 rot90 reads as vertical.
  const rotation = stderr.match(/rotation of (-?\d+(?:\.\d+)?) degrees/);
  if (rotation && Math.abs((Math.abs(Number(rotation[1])) % 180) - 90) < 1) [width, height] = [height, width];
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null;
  // ffmpeg prints "…, 5994 kb/s, 59.94 fps, 59.94 tbr, 90k tbn" — take the fps
  // field, not tbr, which on a VFR recording is the ceiling rather than the rate.
  const rate = stderr.match(/Video:[^\n]*?,\s*([\d.]+)\s*fps\b/);
  const fps = rate && Number(rate[1]) > 0 ? Number(rate[1]) : null;
  return { width, height, durationSec, fps };
}

/** Reads the video's display dimensions, duration and frame rate by parsing `ffmpeg -i`. */
export async function probeVideoStream(
  inputPath: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<VideoStreamInfo> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true, signal });
  const info = parseVideoStreamInfo(stderr);
  if (!info) {
    throw new Error("Could not read the video dimensions — the file may be corrupt or not a video.");
  }
  return info;
}
