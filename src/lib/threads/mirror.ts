import { isImagePost } from "@/lib/publisher/images";
import { localCalendarParts } from "@/lib/publisher/time";
import type { QueueItem } from "@/lib/publisher/types";
import { THREADS_CAROUSEL_MAX } from "@/lib/threads/api";
import type { ThreadsConfig } from "@/lib/threads/config";
import { fitToThreads } from "@/lib/threads/plan";
import { plugReplyFor } from "@/lib/threads/plug";
import type { ThreadsMedia, ThreadsQueueItem } from "@/lib/threads/types";
import { breaksPersona } from "@/lib/x-drafts/voice";

const MINUTE = 60_000;

export type MirrorConfig = {
  enabled: boolean;
  carousels: boolean;
  offsetMinutes: number;
  lookbackHours: number;
  gapMinutes: number;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim().toLowerCase();
}

function num(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function mirrorConfig(): MirrorConfig {
  return {
    enabled: env("THREADS_MIRROR") === "on" || (env("THREADS_MIRROR") !== "off" && env("THREADS_MIRROR") !== "false" && env("NODE_ENV") !== "test"),
    carousels: env("THREADS_MIRROR_CAROUSELS") !== "off" && env("THREADS_MIRROR_CAROUSELS") !== "false",
    offsetMinutes: num("THREADS_MIRROR_OFFSET_MINUTES", 20, 0, 240),
    lookbackHours: num("THREADS_MIRROR_LOOKBACK_HOURS", 12, 1, 72),
    gapMinutes: num("THREADS_MIRROR_GAP_MINUTES", 30, 0, 180)
  };
}

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

export function threadsCaption(item: Pick<QueueItem, "caption" | "title">): string {
  const caption = item.caption.replace(HASHTAG, "$1").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  return fitToThreads(caption || item.title.replace(/\s*\((?:short|reel|clip)-[a-z0-9]+\)\s*$/i, "").trim());
}

export function mediaFor(item: QueueItem): ThreadsMedia | null {
  if (isImagePost(item)) {
    const keys = item.imageKeys ?? [];
    if (keys.length === 0 || keys.length !== (item.imagePaths?.length ?? keys.length) || keys.some((key) => !key)) return null;
    return { kind: keys.length === 1 ? "image" : "carousel", keys: keys.slice(0, THREADS_CAROUSEL_MAX) };
  }
  return item.mediaKey ? { kind: "video", keys: [item.mediaKey] } : null;
}

export type MirrorPlan = { items: ThreadsQueueItem[]; notes: Array<{ itemId: string; note: string }> };

export function planInstagramMirrors(input: {
  publishItems: QueueItem[];
  queue: ThreadsQueueItem[];
  threads: ThreadsConfig;
  mirror: MirrorConfig;
  now: Date;
  newId?: () => string;
}): MirrorPlan {
  const plan: MirrorPlan = { items: [], notes: [] };
  const account = input.threads.accounts[0];
  if (!input.mirror.enabled || !account) return plan;
  const nextId = input.newId ?? (() => `thread-${crypto.randomUUID()}`);
  const mirrored = new Set(input.queue.map((item) => item.sourceItemId).filter(Boolean));
  const queuedText = new Set(input.queue.filter((item) => item.status !== "skipped").map((item) => item.text.trim()));
  const since = input.now.getTime() - input.mirror.lookbackHours * 60 * MINUTE;
  const occupied = input.queue
    .filter((item) => item.accountId === account.id && item.status !== "skipped" && item.status !== "failed")
    .map((item) => new Date(item.publishedAt ?? item.publishAt).getTime());

  const candidates = input.publishItems
    .map((item) => ({ item, leg: item.platforms.instagram }))
    .filter(({ item, leg }) => leg?.status === "published" && leg.publishedAt && Date.parse(leg.publishedAt) >= since && !mirrored.has(item.id))
    .sort((a, b) => a.leg!.publishedAt!.localeCompare(b.leg!.publishedAt!));

  for (const { item, leg } of candidates) {
    if (item.visibility !== "public") {
      plan.notes.push({ itemId: item.id, note: "Not public, so it stays off Threads." });
      continue;
    }
    const media = mediaFor(item);
    if (!media) {
      plan.notes.push({ itemId: item.id, note: "Its media is not hosted, so Threads would have nothing to fetch." });
      continue;
    }
    if (media.kind !== "video" && !input.mirror.carousels) {
      plan.notes.push({ itemId: item.id, note: "Picture posts are not mirrored (THREADS_MIRROR_CAROUSELS=off)." });
      continue;
    }
    const text = threadsCaption(item);
    if (!text) {
      plan.notes.push({ itemId: item.id, note: "No caption to post with it." });
      continue;
    }
    if (breaksPersona(text)) {
      plan.notes.push({ itemId: item.id, note: "The caption talks about engineering work, so it stays off Threads." });
      continue;
    }
    if (queuedText.has(text)) {
      plan.notes.push({ itemId: item.id, note: "The same words are already on the Threads queue." });
      continue;
    }
    let at = Math.max(Date.parse(leg!.publishedAt!) + input.mirror.offsetMinutes * MINUTE, input.now.getTime() + 5 * MINUTE);
    const gap = input.mirror.gapMinutes * MINUTE;
    for (let guard = 0; guard < 96 && occupied.some((time) => Math.abs(time - at) < gap); guard += 1) at += gap > 0 ? Math.min(gap, 10 * MINUTE) : MINUTE;
    occupied.push(at);
    queuedText.add(text);
    mirrored.add(item.id);
    const id = nextId();
    const publishAt = new Date(at).toISOString();
    const plugText = plugReplyFor(text, id, input.threads, "pipeline");
    const kind = media.kind === "video" ? "Reel" : media.kind === "carousel" ? "carousel" : "picture";
    plan.items.push({
      id,
      batchDate: localCalendarParts(publishAt, input.threads.timezone).dateKey,
      slot: 0,
      accountId: account.id,
      version: account.posts,
      topic: `Instagram ${kind}: ${item.title}`.slice(0, 80),
      format: `instagram-${media.kind}`,
      text,
      publishAt,
      status: "pending",
      ...(plugText ? { plugText } : {}),
      attempts: 0,
      createdAt: input.now.toISOString(),
      origin: "pipeline",
      sourceItemId: item.id,
      media
    });
  }
  return plan;
}
