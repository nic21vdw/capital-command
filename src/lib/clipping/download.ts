import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveFfmpeg } from "@/lib/clipping/ffmpeg";

// yt-dlp ships a single self-contained binary per platform, so we can fetch and
// cache it on first use instead of asking the user to install anything.
const binDir = path.join(process.cwd(), "data", "clips", "bin");

function binaryName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  return "yt-dlp_linux";
}

function downloadUrl() {
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName()}`;
}

/** Directory holding the bundled ffmpeg, so yt-dlp can merge/cut without a system install. */
function ffmpegLocation(): string | null {
  const bin = resolveFfmpeg();
  // `ffmpeg` (a bare PATH lookup) gives yt-dlp nothing useful; only pass a real path.
  return bin && bin !== "ffmpeg" ? path.dirname(bin) : null;
}

let cached: string | null | undefined;

function canRun(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"], { windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a usable yt-dlp binary: one already on PATH, then a previously
 * cached download, otherwise fetches the latest release for this platform.
 */
export async function ensureYtDlp(): Promise<string> {
  if (cached) return cached;

  // 1. Prefer a system install if the user already has one.
  for (const name of process.platform === "win32" ? ["yt-dlp.exe", "yt-dlp"] : ["yt-dlp"]) {
    if (await canRun(name)) {
      cached = name;
      return cached;
    }
  }

  // 2. Reuse a binary we downloaded on an earlier run.
  const localPath = path.join(binDir, binaryName());
  if (await fileExists(localPath)) {
    cached = localPath;
    return cached;
  }

  // 3. Download it. (The URL feature already needs outbound network.)
  await mkdir(binDir, { recursive: true });
  const tmpPath = `${localPath}.partial`;
  const response = await fetch(downloadUrl(), { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download yt-dlp (HTTP ${response.status}). Check your internet connection, or install yt-dlp manually and put it on your PATH.`
    );
  }
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmpPath);
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      .pipe(out)
      .on("finish", () => resolve())
      .on("error", reject);
  });
  await rename(tmpPath, localPath);
  if (process.platform !== "win32") {
    await chmod(localPath, 0o755);
  }
  cached = localPath;
  return cached;
}

export type YtDlpResult = { stdout: string; stderr: string; code: number };

/** Runs yt-dlp, streaming stderr lines to an optional progress callback. */
export function runYtDlp(
  args: string[],
  bin: string,
  { onLine, allowFailure = false }: { onLine?: (line: string) => void; allowFailure?: boolean } = {}
): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
      if (onLine) {
        // yt-dlp redraws progress with \r; split on both so we see live %.
        lineBuffer += text;
        const parts = lineBuffer.split(/[\r\n]/);
        lineBuffer = parts.pop() ?? "";
        for (const part of parts) if (part.trim()) onLine(part.trim());
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !allowFailure) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-600)}`));
      } else {
        resolve({ stdout, stderr, code: code ?? -1 });
      }
    });
  });
}

const ffmpegArgs = () => {
  const loc = ffmpegLocation();
  return loc ? ["--ffmpeg-location", loc] : [];
};

export type VideoMeta = { title: string; durationSec: number; id: string };

/** Reads VOD metadata (title, duration) without downloading the media. */
export async function fetchVideoMeta(url: string): Promise<VideoMeta> {
  const bin = await ensureYtDlp();
  const { stdout } = await runYtDlp(
    ["--dump-single-json", "--no-playlist", "--no-warnings", url],
    bin
  );
  let data: { title?: string; duration?: number; id?: string };
  try {
    data = JSON.parse(stdout) as typeof data;
  } catch {
    throw new Error("yt-dlp could not read that URL. Make sure it is a public video/VOD link.");
  }
  return {
    title: data.title?.trim() || "Untitled stream",
    durationSec: Math.round(data.duration ?? 0),
    id: data.id ?? "video"
  };
}

/**
 * Downloads just the audio track (small + fast) for analysis and transcription.
 * Returns the path to a 16 kHz mono MP3.
 */
export async function downloadAudio(
  url: string,
  destDir: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const bin = await ensureYtDlp();
  const template = path.join(destDir, "source-audio.%(ext)s");
  await runYtDlp(
    [
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "7",
      "--postprocessor-args",
      "ExtractAudio:-ac 1 -ar 16000",
      "--no-playlist",
      "--no-part",
      "-o",
      template,
      ...ffmpegArgs(),
      url
    ],
    bin,
    {
      onLine: (line) => {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m && onProgress) onProgress(Number(m[1]));
      }
    }
  );
  const produced = await findProduced(destDir, "source-audio.");
  if (!produced) throw new Error("Audio download finished but no audio file was produced.");
  return produced;
}

/**
 * Downloads a single time range [startSec, endSec] of the source as an MP4,
 * capped at 720p so it stays fast and small. Returns the produced file path.
 *
 * We deliberately do NOT pass --force-keyframes-at-cuts: that flag re-encodes
 * the whole section just to land cuts on exact frames, which is the single
 * biggest slowdown per clip. yt-dlp instead stream-copies from the nearest
 * keyframe (much faster), and the final 9:16 render re-encodes anyway, so the
 * precise trim is applied there.
 */
export async function downloadSection(
  url: string,
  startSec: number,
  endSec: number,
  destPath: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const bin = await ensureYtDlp();
  const dir = path.dirname(destPath);
  const base = path.basename(destPath, path.extname(destPath));
  const template = path.join(dir, `${base}.%(ext)s`);
  await runYtDlp(
    [
      "-f",
      "b[height<=720][ext=mp4]/b[height<=720]/bv*[height<=720]+ba/b",
      "--download-sections",
      `*${startSec.toFixed(2)}-${endSec.toFixed(2)}`,
      "--no-playlist",
      "--no-part",
      "--merge-output-format",
      "mp4",
      "-o",
      template,
      ...ffmpegArgs(),
      url
    ],
    bin,
    {
      onLine: (line) => {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m && onProgress) onProgress(Number(m[1]));
      }
    }
  );
  const produced = await findProduced(dir, `${base}.`);
  if (!produced) throw new Error(`Section ${startSec}-${endSec}s download produced no file.`);
  return produced;
}

/** Finds the file yt-dlp actually wrote (its extension can differ from the template). */
async function findProduced(dir: string, prefix: string): Promise<string | null> {
  const entries = await readdir(dir);
  const match = entries.find((name) => name.startsWith(prefix) && !name.endsWith(".part"));
  return match ? path.join(dir, match) : null;
}
