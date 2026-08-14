/**
 * Apple-style emoji rendering for the thumbnail generator.
 *
 * Native canvas `fillText` draws whatever emoji font the OS ships — Apple Color
 * Emoji on macOS/iOS, but Segoe UI Emoji on Windows and Noto on Android/Linux.
 * To get a consistent Apple look everywhere we draw emoji from the open
 * `iamcal/emoji-data` Apple image set (served with permissive CORS by jsDelivr),
 * falling back to native `fillText` until the image has loaded.
 *
 * Naming the image is shared with the carousel renderer — see
 * `src/lib/emoji/apple.ts`. This file is the browser-side cache around it.
 */

import { appleEmojiUrl, emojiCodepoints } from "@/lib/emoji/apple";

export { appleEmojiUrl, emojiCodepoints };

type Entry = { img: HTMLImageElement; ready: boolean; failed: boolean };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** Subscribe to be notified when any Apple emoji image finishes loading. */
export function subscribeEmojiLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Returns a decoded Apple emoji image ready to draw, or `null` if it isn't
 * available yet (in which case a load is kicked off once and subscribers are
 * notified on completion). Returns `null` permanently for glyphs that fail to
 * load, so callers can fall back to native `fillText` without retry loops.
 */
export function getAppleEmojiImage(emoji: string): HTMLImageElement | null {
  if (typeof document === "undefined" || !emoji) return null;
  const url = appleEmojiUrl(emoji);
  const existing = cache.get(url);
  if (existing) return existing.ready ? existing.img : null;

  const img = new Image();
  img.crossOrigin = "anonymous";
  const entry: Entry = { img, ready: false, failed: false };
  img.onload = () => {
    entry.ready = true;
    listeners.forEach((cb) => cb());
  };
  img.onerror = () => {
    entry.failed = true;
  };
  img.src = url;
  cache.set(url, entry);
  return null;
}
