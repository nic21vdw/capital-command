import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { writeAppData } from "@/lib/storage/store";
import type { AppData, ClipProject } from "@/types/domain";

/**
 * Image overlays used to carry their picture inline as a data URL. One
 * watermark is ~476 KB of base64, and it was copied into every clip project it
 * was applied to — 18 projects came to 8.6 MB of the app-data file. That file
 * is rewritten on every mutation and shipped to the browser in full on every
 * page load, which is what left the dashboard unable to respond to a click.
 *
 * So overlay pictures live on disk, exactly like carousel photos, and the
 * overlay keeps a URL. Files are named by content hash, so the same watermark
 * on a hundred clips is one file on disk.
 */

const imagesRoot = () => dataPath("overlay-images");

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg"
};

export function isDataUrl(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

/** Where a stored overlay image is served from. */
export function overlayImageUrl(file: string): string {
  return `/api/clips/overlay-images/${file}`;
}

/** Absolute path of a stored overlay image, or null if the name is unsafe. */
export function overlayImagePath(file: string): string | null {
  const safe = path.basename(file);
  if (safe !== file || !safe || safe.startsWith(".")) return null;
  return path.join(imagesRoot(), safe);
}

/**
 * Writes a data URL to disk and returns the URL to reach it. Identical bytes
 * always produce the same file, so re-saving a project costs nothing.
 */
export async function storeOverlayImage(dataUrl: string): Promise<string> {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return dataUrl;

  const [, mime, base64, payload] = match;
  const bytes = base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  const extension = EXTENSIONS[mime.toLowerCase()] ?? "bin";
  const file = `${createHash("sha1").update(bytes).digest("hex")}.${extension}`;

  const target = path.join(imagesRoot(), file);
  await mkdir(imagesRoot(), { recursive: true });
  await writeFile(target, bytes);

  return overlayImageUrl(file);
}

/**
 * Moves every inline overlay picture in a project onto disk. Returns the same
 * object when there was nothing to move, so callers can skip a write.
 */
export async function externalizeProjectOverlays(project: ClipProject): Promise<ClipProject> {
  const overlays = project.overlays ?? [];
  if (!overlays.some((overlay) => isDataUrl(overlay.src))) return project;

  const moved = await Promise.all(
    overlays.map(async (overlay) =>
      isDataUrl(overlay.src) ? { ...overlay, src: await storeOverlayImage(overlay.src) } : overlay
    )
  );

  return { ...project, overlays: moved };
}

/**
 * The same for a whole collection. `changed` says whether anything moved, so a
 * read that repairs old data only writes when it actually found something.
 */
/**
 * Repairs app data that still carries overlay pictures inline, and persists the
 * result. Both read routes call this, because there is nothing to press: the
 * moment the app serves its first request the base64 watermarks move to disk,
 * the payload the browser has to parse drops with them, and the dashboard can
 * respond to a click again. It writes only when it moved something.
 */
export async function repairAppDataOverlays(data: AppData): Promise<AppData> {
  const { projects, changed } = await externalizeAllOverlays(data.clipProjects ?? []);
  const withImages = await externalizeAppDataImages(changed ? { ...data, clipProjects: projects } : data);
  if (!changed && withImages === data) return data;

  const repaired = changed ? { ...withImages, clipProjects: projects } : withImages;
  await writeAppData(repaired);
  return repaired;
}

/**
 * The same treatment for the pictures that are not overlays: the brand logo and
 * watermark a project starts from, and the profile avatar. They were the
 * ORIGINALS the overlays were copied from, and externalizing only the copies
 * left the biggest one behind — the watermark alone was 487 KB of base64, a
 * fifth of everything the browser downloads and parses on every page, and it
 * was rewritten to disk on every keystroke that saved app data.
 *
 * Returns the same object when there was nothing to move, so a read that
 * repairs old data only writes when it actually found something.
 */
export async function externalizeAppDataImages(data: AppData): Promise<AppData> {
  const brand = data.brandAssets;
  const avatar = data.settings?.profile?.avatar;
  const inlineBrand = isDataUrl(brand?.logoSrc) || isDataUrl(brand?.watermarkSrc);
  if (!inlineBrand && !isDataUrl(avatar)) return data;

  const next = { ...data };
  if (inlineBrand && brand) {
    next.brandAssets = {
      ...brand,
      ...(isDataUrl(brand.logoSrc) ? { logoSrc: await storeOverlayImage(brand.logoSrc) } : {}),
      ...(isDataUrl(brand.watermarkSrc) ? { watermarkSrc: await storeOverlayImage(brand.watermarkSrc) } : {})
    };
  }
  if (isDataUrl(avatar) && data.settings) {
    next.settings = {
      ...data.settings,
      profile: { ...data.settings.profile, avatar: await storeOverlayImage(avatar) }
    };
  }
  return next;
}

export async function externalizeAllOverlays(
  projects: ClipProject[]
): Promise<{ projects: ClipProject[]; changed: boolean }> {
  let changed = false;
  const next = await Promise.all(
    projects.map(async (project) => {
      const moved = await externalizeProjectOverlays(project);
      if (moved !== project) changed = true;
      return moved;
    })
  );

  return { projects: changed ? next : projects, changed };
}
