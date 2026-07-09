import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getDataRoot } from "@/lib/storage/data-root";

// Videos dropped straight onto a schedule slot (bypassing the clip generator)
// live under <workspace>/uploads/<id>/ — one folder per upload, so the derived
// vertical render the publisher may cache next to the file stays contained.
export function uploadDir(id: string) {
  return path.join(getDataRoot(), "uploads", id);
}

function extFromName(name: string, mime: string) {
  const fromName = path.extname(name).toLowerCase();
  if (fromName && fromName.length <= 6) return fromName;
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return ".mov";
  if (mime.includes("matroska")) return ".mkv";
  return ".mp4";
}

/** Keep the stored name readable (it ends up in the queue's clipPath). */
function safeBaseName(name: string) {
  const base = path.basename(name, path.extname(name));
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "upload";
}

export type SavedUpload = {
  id: string;
  /** Absolute path of the stored video. */
  path: string;
};

/**
 * Streams an incoming request body straight to disk (never buffering the
 * whole file in memory), mirroring the clip-source upload flow.
 */
export async function saveUploadFromStream(
  body: ReadableStream<Uint8Array>,
  fileName: string,
  mime: string
): Promise<SavedUpload> {
  const id = crypto.randomUUID().slice(0, 12);
  await mkdir(uploadDir(id), { recursive: true });
  const dest = path.join(uploadDir(id), `${safeBaseName(fileName)}${extFromName(fileName, mime)}`);
  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
  return { id, path: dest };
}

/** Best-effort cleanup when the enqueue after an upload fails. */
export async function deleteUpload(id: string) {
  await rm(uploadDir(id), { recursive: true, force: true }).catch(() => undefined);
}
