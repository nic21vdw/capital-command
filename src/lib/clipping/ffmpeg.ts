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

export type FfmpegResult = {
  stdout: string;
  stderr: string;
  code: number;
};

/** Runs ffmpeg with the given args, capturing stdout/stderr. */
export function runFfmpeg(args: string[], { allowFailure = false } = {}): Promise<FfmpegResult> {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error(FFMPEG_MISSING_MESSAGE));
      return;
    }
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      // Keep memory bounded on long renders; we only ever parse the tail.
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(FFMPEG_MISSING_MESSAGE));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code !== 0 && !allowFailure) {
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

/** Whether the file has at least one audio stream. */
export async function hasAudioStream(inputPath: string): Promise<boolean> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { allowFailure: true });
  return /Stream #\d+:\d+.*Audio/.test(stderr);
}
