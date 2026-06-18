import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Optional Google Drive mirroring.
 *
 * There is no API or sign-in here on purpose. Instead this copies finished
 * clips into a normal folder on disk. If that folder lives inside a folder
 * synced by Google Drive for Desktop, the clips appear in your Google Drive
 * automatically — no keys, no OAuth, no uploads from the app itself.
 *
 * Set CLIPS_DRIVE_DIR to a path inside your synced Drive folder to turn this
 * on. Leave it blank and clips simply stay under data/clips/outputs.
 */

/** Top-level folder created inside your Drive folder. */
const PARENT_FOLDER = "clipping agent";

/** Characters Windows/macOS reject in file and folder names. */
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*]/g;

/** The configured Drive-synced destination, or null when the feature is off. */
export function driveDir(): string | null {
  const dir = process.env.CLIPS_DRIVE_DIR?.trim();
  return dir ? dir : null;
}

/**
 * Make a stream title safe to use as a folder name across Windows/macOS/Linux:
 * drop characters those filesystems reject, collapse whitespace, and avoid a
 * trailing dot or space (which Windows silently strips).
 */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(ILLEGAL_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned.slice(0, 120).trim() || "Untitled stream";
}

/**
 * Copy the given clips into "<CLIPS_DRIVE_DIR>/clipping agent/<stream title>/".
 * Returns the destination folder and how many files were copied. Throws if the
 * feature is not configured.
 */
export async function copyClipsToDrive(
  streamTitle: string,
  clips: Array<{ sourcePath: string; fileName: string }>
): Promise<{ folder: string; copied: number }> {
  const root = driveDir();
  if (!root) throw new Error("CLIPS_DRIVE_DIR is not set.");

  const folder = path.join(root, PARENT_FOLDER, sanitizeFolderName(streamTitle));
  await mkdir(folder, { recursive: true });

  let copied = 0;
  for (const clip of clips) {
    await copyFile(clip.sourcePath, path.join(folder, clip.fileName));
    copied++;
  }
  return { folder, copied };
}
