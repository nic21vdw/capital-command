import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CarouselImage } from "@/lib/carousels/imageSlides";
import { dataPath } from "@/lib/paths";

/**
 * Storage for photos uploaded as carousel slide material.
 *
 * The slide editor keeps a dropped image inline as a data URL, which is fine for
 * one logo. A batch of twenty photos is not: base64 of that goes into
 * `data/capital-command.json`, which is read and rewritten on every app-data
 * operation. So a batch lands on disk here and slides reference it by URL —
 * same-origin, so `canvas.toBlob()` still works when the slides export.
 */

const imagesRoot = dataPath("carousel-images");

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};

const TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif"
};

/** Big enough for a phone photo, small enough that a batch can't fill the disk. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** Instagram's own per-post ceiling, so a batch can always be posted as one carousel. */
export const MAX_BATCH_IMAGES = 20;

export const SUPPORTED_IMAGE_TYPES = Object.keys(EXTENSION_BY_TYPE);

/** Stored image ids are `<uuid>.<ext>` — the shape a URL is allowed to name. */
const ID_PATTERN = /^[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/i;

export function carouselImageUrl(id: string): string {
  return `/api/studio/carousels/images/${id}`;
}

/** The id inside a slide-image URL, or null when the string is anything else. */
export function parseCarouselImageId(url: string): string | null {
  const match = url.trim().match(/^\/api\/studio\/carousels\/images\/([^/?#]+)$/);
  const id = match?.[1];
  return id && ID_PATTERN.test(id) ? id : null;
}

export function carouselImageContentType(id: string): string {
  const extension = id.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** Absolute path of a stored image, or null when the id is not one of ours. */
export function carouselImagePath(id: string): string | null {
  if (!ID_PATTERN.test(id)) return null;
  return path.join(imagesRoot, id);
}

/** True when the id names a file that is actually on disk. */
export async function carouselImageExists(id: string): Promise<boolean> {
  const target = carouselImagePath(id);
  if (!target) return false;
  return stat(target).then(
    () => true,
    () => false
  );
}

export async function saveCarouselImage(
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
  fileName?: string
): Promise<CarouselImage> {
  const extension = EXTENSION_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()];
  if (!extension) throw new Error(`${fileName ?? "That file"} is not a PNG, JPEG, WebP or GIF.`);
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength === 0) throw new Error(`${fileName ?? "That file"} is empty.`);
  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${fileName ?? "That file"} is larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB.`);
  }
  const id = `${crypto.randomUUID()}.${extension}`;
  await mkdir(imagesRoot, { recursive: true });
  await writeFile(path.join(imagesRoot, id), data);
  return { id, url: carouselImageUrl(id), fileName: fileName?.trim() || undefined };
}
