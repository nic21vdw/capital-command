import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { appleEmojiUrls, emojiCodepoints } from "@/lib/emoji/apple";
import { dataPath } from "@/lib/paths";

/**
 * The Apple emoji pictures the server draws slides with, kept on disk.
 *
 * A booked carousel is rasterised by the publish runner, which can be days after
 * the deck was written and does not get to wait on a CDN — so every glyph is
 * downloaded once, filed by codepoint, and read from disk every time after. The
 * cache is the point: the network is touched on a deck's FIRST render and never
 * again for that emoji.
 *
 * A download that fails is remembered as a miss for the life of the process
 * rather than retried per slide, and the renderer simply leaves that glyph out.
 * A carousel going out without one emoji beats a carousel that did not go out.
 */

const cacheRoot = dataPath("emoji-apple");

/** Long enough that a slow CDN cannot hold a publish run open. */
const FETCH_TIMEOUT_MS = 8000;

const misses = new Set<string>();
const inFlight = new Map<string, Promise<Buffer | null>>();

function cachePath(glyph: string): string {
  return path.join(cacheRoot, `${emojiCodepoints(glyph)}.png`);
}

async function download(glyph: string): Promise<Buffer | null> {
  for (const url of appleEmojiUrls(glyph)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
    if (!response?.ok) continue;
    // The body read gets its own guard: a reset connection or the timeout
    // firing after the headers arrived rejects HERE, and an unguarded throw
    // takes the whole deck down with it.
    const body = await response.arrayBuffer().catch(() => null);
    if (!body?.byteLength) continue;
    return Buffer.from(body);
  }
  return null;
}

/** The PNG bytes for one emoji, from disk if they are there and the CDN if not. */
export async function appleEmojiBytes(glyph: string): Promise<Buffer | null> {
  const key = emojiCodepoints(glyph);
  if (!key || misses.has(key)) return null;

  const file = cachePath(glyph);
  // A zero-length file is not a cached emoji, it is a write that was killed
  // half way — and a release tree-kills the running server. Read as a hit it
  // would blank that glyph forever, with nothing to invalidate it.
  const stored = await readFile(file).catch(() => null);
  if (stored?.length) return stored;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const bytes = await download(glyph);
    if (!bytes) {
      misses.add(key);
      return null;
    }
    await mkdir(cacheRoot, { recursive: true }).catch(() => null);
    // Written aside and renamed, so a kill mid-write leaves the temporary file
    // rather than a truncated PNG under the name the next run will trust.
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, bytes)
      .then(() => rename(temporary, file))
      .catch(() => rm(temporary, { force: true }).catch(() => null));
    return bytes;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}
