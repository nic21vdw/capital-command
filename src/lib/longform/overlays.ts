import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { projectWorkDir } from "@/lib/longform/store";

// Storage for timeline overlay images. Each project keeps its dropped-in
// images next to its render work files; the overlay records on the project
// point at them by stored name. Files are named `${id}.${ext}` so a single
// image id maps to exactly one file on disk.

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"]);

function extFromName(fileName: string, mime: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTS.has(fromName)) return fromName;
  if (mime.includes("png")) return ".png";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("avif")) return ".avif";
  if (mime.includes("bmp")) return ".bmp";
  return ".jpg";
}

export function overlayImageDir(projectId: string) {
  return path.join(projectWorkDir(projectId), "images");
}

export function overlayFilePath(projectId: string, storedName: string) {
  return path.join(overlayImageDir(projectId), storedName);
}

export type SavedOverlayImage = {
  id: string;
  fileName: string;
  storedName: string;
  mime: string;
  sizeBytes: number;
};

/** Streams an uploaded image straight to disk under the project. */
export async function saveOverlayImage(
  projectId: string,
  body: ReadableStream<Uint8Array>,
  fileName: string,
  mime: string
): Promise<SavedOverlayImage> {
  const id = crypto.randomUUID().slice(0, 12);
  const storedName = `${id}${extFromName(fileName, mime)}`;
  const dir = overlayImageDir(projectId);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, storedName);
  await pipeline(
    Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(dest)
  );
  const { size } = await stat(dest);
  return { id, fileName, storedName, mime: mime || "image/jpeg", sizeBytes: size };
}

/** Deletes every image file for an overlay id (defensive against stray files). */
export async function deleteOverlayImage(projectId: string, imageId: string) {
  const dir = overlayImageDir(projectId);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name === imageId || name.startsWith(`${imageId}.`))
      .map((name) => rm(path.join(dir, name), { force: true }))
  );
}

/** Reads an overlay image file, or null if it is missing. */
export async function readOverlayImage(projectId: string, storedName: string): Promise<Buffer | null> {
  try {
    return await readFile(overlayFilePath(projectId, storedName));
  } catch {
    return null;
  }
}
