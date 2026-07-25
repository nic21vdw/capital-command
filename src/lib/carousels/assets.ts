import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ASSET_ROOT = path.join(process.cwd(), "data", "carousels", "assets");
const SAFE_FILE = /^[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/i;

export async function saveCarouselAsset(bytes: Uint8Array, extension: "jpg" | "png" | "webp" = "jpg") {
  await mkdir(ASSET_ROOT, { recursive: true });
  const file = `${crypto.randomUUID()}.${extension}`;
  await writeFile(path.join(ASSET_ROOT, file), bytes);
  return `/api/studio/carousels/assets/${file}`;
}

export async function readCarouselAsset(file: string) {
  if (!SAFE_FILE.test(file) || path.basename(file) !== file) return null;
  return readFile(path.join(ASSET_ROOT, file)).catch(() => null);
}
