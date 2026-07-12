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

/** Runs ffmpeg with the given args, capturing stdout/stderr. */
export function runFfmpeg(
  args: string[],
  {
    allowFailure = false,
    onLine,
    signal
  }: { allowFailure?: boolean; onLine?: (line: string) => void; signal?: AbortSignal } = {}
): Promise<FfmpegResult> {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error(FFMPEG_MISSING_MESSAGE));
      return;
    }
    // Already stopped before we even spawned — don't start a doomed process.
    if (signal?.aborted) {
      reject(new RenderCanceledError());
      return;
    }
    const child = spawn(bin, args, { windowsHide: true });
    // Stopping the export kills the ffmpeg process so it releases the CPU/GPU
    // and stops writing immediately, then the promise rejects as canceled.
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* process may have already exited */
      }
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      // Keep memory bounded on long renders. Anything that must see every
      // line (e.g. silencedetect output on a multi-hour stream) has to parse
      // via onLine — the captured stderr only reliably holds the tail.
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
      if (onLine) {
        // ffmpeg redraws progress with \r; split on both so we see live time=.
        lineBuffer += text;
        const parts = lineBuffer.split(/[\r\n]/);
        lineBuffer = parts.pop() ?? "";
        for (const part of parts) if (part.trim()) onLine(part.trim());
      }
    });
    child.on("error", (error) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(FFMPEG_MISSING_MESSAGE));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      // A non-zero exit caused by our own SIGKILL is a stop, not a failure.
      if (signal?.aborted) {
        reject(new RenderCanceledError());
      } else if (code !== 0 && !allowFailure) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
      } else {
        resolve({ stdout, stderr, code: code ?? -1 });
      }
    });
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
  return { width, height, durationSec };
}

/** Reads the video's display dimensions and duration by parsing `ffmpeg -i`. */
export async function probeVideoStream(inputPath: string): Promise<VideoStreamInfo> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true });
  const info = parseVideoStreamInfo(stderr);
  if (!info) {
    throw new Error("Could not read the video dimensions — the file may be corrupt or not a video.");
  }
  return info;
}
