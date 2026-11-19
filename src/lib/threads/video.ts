import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { hostingConfigured, publisherConfig } from "@/lib/publisher/config";
import { S3MediaHost } from "@/lib/publisher/hosting";
import { uploadDir } from "@/lib/publisher/uploads";
import { localCalendarParts } from "@/lib/publisher/time";
import { THREADS_TEXT_LIMIT, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const FETCH_URL_SECONDS = 15 * 60;
const MINUTE_MS = 60_000;
export const THREADS_VIDEO_GRACE_MINUTES = 10;

export type ThreadsVideoInput = {
  jobId: string;
  fileName: string;
  text: string;
  accountId: string;
  publishAt: string;
};

export type ThreadsVideoTarget = ThreadsVideoInput & {
  sha256: string;
  userId: string;
  username: string;
  timezone: string;
  latestAt: string;
};

export type ThreadsVideoBooking = {
  commandId: string;
  target: ThreadsVideoTarget;
  digest: string;
  verifiedAt?: string;
  permalink?: string;
  providerTimestamp?: string;
};

export class ThreadsVideoError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function videoDeliveryProfile(config = publisherConfig()) {
  // The owner must verify the named existing bucket has no public access
  // (including through R2.dev or a custom domain). An unset public URL alone
  // cannot prove that. Only signed GET is available on this path.
  const declaredPrivateBucket = process.env.THREADS_PRIVATE_VIDEO_BUCKET?.trim();
  const endpoint = config.s3.endpoint?.replace(/\/$/, "") ?? "";
  return hostingConfigured(config) && declaredPrivateBucket === config.s3.bucket
    && !config.s3.publicBaseUrl && /^https:\/\/[a-f\d]{32}\.r2\.cloudflarestorage\.com$/i.test(endpoint)
    ? config.s3 : null;
}

function fault(message: string, status?: number): never {
  throw new ThreadsVideoError(message, status);
}

function safeClipSegment(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export async function readThreadsExport(jobId: string, fileName: string) {
  if (!safeClipSegment(jobId) || !/^export-[a-zA-Z0-9_-]{1,120}\.mp4$/.test(fileName)) {
    return fault("Choose a finished MP4 from Clip Editor.", 400);
  }
  const importId = /^upload-([a-f0-9]{8}-[a-f0-9]{3})$/.exec(jobId)?.[1];
  let root: string;
  if (importId && fileName === "export-threads.mp4") {
    root = uploadDir(importId);
  } else {
    const job = await getJob(jobId);
    if (!job?.clips.some((clip) => clip.editedFile === fileName)) {
      return fault("This MP4 is no longer the current export for a local clip. Review the new export.");
    }
    root = outputDir(jobId);
  }
  const file = path.join(root, fileName);
  try {
    if (path.relative(file, await realpath(file))) return fault("The export must stay in its original local output folder.");
    const entry = await lstat(file);
    if (!entry.isFile() || entry.nlink !== 1 || entry.size < 1024 || entry.size > MAX_VIDEO_BYTES) {
      return fault("Choose a local MP4 export no larger than 100 MB.", 400);
    }
    const handle = await open(file, "r");
    try {
      const before = await handle.stat();
      if (before.dev !== entry.dev || before.ino !== entry.ino || before.size !== entry.size) {
        return fault("The local export changed. Review it again.");
      }
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs) return fault("The local export changed. Review it again.");
      if (bytes.toString("ascii", 4, 8) !== "ftyp") return fault("Choose an MP4 file with the final cut.", 400);
      return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ThreadsVideoError) throw error;
    return fault("The local MP4 export could not be read. Check the Clip Editor export.");
  }
}

export function videoTarget(
  input: ThreadsVideoInput,
  profile: { userId: string; username: string },
  version: { sha256: string },
  config: ThreadsConfig,
  now: Date
): ThreadsVideoTarget {
  if (!config.videoOnly || !config.enabled) return fault("Turn on Threads video-only mode on the owning app before booking.");
  const scheduled = new Date(input.publishAt);
  const time = scheduled.getTime();
  if (!Number.isFinite(time) || scheduled.toISOString() !== input.publishAt || time % MINUTE_MS !== 0
    || time < now.getTime() + MINUTE_MS || time > now.getTime() + 60 * 24 * 60 * MINUTE_MS) {
    return fault("Choose an exact future minute within the next 60 days.", 400);
  }
  if (!input.text.trim() || input.text.length > THREADS_TEXT_LIMIT) return fault("Enter a Threads caption of 1–500 characters.", 400);
  const lag = Math.max(0, Math.min(THREADS_VIDEO_GRACE_MINUTES, config.lateGraceMinutes));
  return { ...input, ...profile, sha256: version.sha256, timezone: config.timezone, latestAt: new Date(time + lag * MINUTE_MS).toISOString() };
}

export function videoDigest(target: ThreadsVideoTarget): string {
  return createHash("sha256").update(JSON.stringify([
    target.jobId, target.fileName, target.sha256, target.text, target.accountId, target.userId, target.username,
    target.publishAt, target.latestAt, target.timezone
  ])).digest("hex");
}

export function videoBookingReceipt(item: ThreadsQueueItem) {
  return {
    id: item.id, accountId: item.accountId, publishAt: item.publishAt, commandId: item.video?.commandId,
    providerState: item.video?.verifiedAt ? "verified" : item.postId ? "accepted" : item.publishAttemptedAt ? "uncertain" : "not_sent",
    status: item.status, postId: item.postId, permalink: item.video?.permalink
  };
}

export function videoReplay(items: ThreadsQueueItem[], commandId: string, target: ThreadsVideoTarget) {
  const old = items.find((item) => item.video?.commandId === commandId);
  if (old && old.video?.digest !== videoDigest(target)) return fault("This approval ID is already bound to a different post.");
  return old;
}

export function planVideoBooking(
  items: ThreadsQueueItem[],
  target: ThreadsVideoTarget,
  account: ThreadsAccount,
  commandId: string,
  now: Date
): ThreadsQueueItem {
  if (items.some(({ video, postId, publishAttemptedAt, containerId, claimedAt, status }) =>
    video?.target.sha256 === target.sha256 && video.target.userId === target.userId
      && (status === "pending" || Boolean(postId || publishAttemptedAt || containerId || claimedAt)))) {
    return fault("This exact export already has a booking or a delivery receipt on this Threads profile.");
  }
  if (items.some((item) => item.status === "pending" && item.publishAt === target.publishAt
      && (item.accountId === target.accountId || item.video?.target.userId === target.userId))) {
    return fault("That account already has a post at this time. Pick and approve a different slot.");
  }
  return {
    id: `thread-video-${randomUUID()}`,
    accountId: target.accountId,
    batchDate: localCalendarParts(new Date(target.publishAt), target.timezone).dateKey,
    slot: 0, origin: "pipeline", version: account.posts, format: "video", topic: "Video",
    text: target.text, publishAt: target.publishAt, status: "pending", attempts: 0,
    createdAt: now.toISOString(), approvedAt: now.toISOString(),
    video: { commandId, target, digest: videoDigest(target) }
  };
}

export function videoBookingMatches(item: ThreadsQueueItem): boolean {
  const video = item.video;
  return Boolean(video && item.approvedAt && item.accountId === video.target.accountId
    && item.text === video.target.text && item.publishAt === video.target.publishAt && video.digest === videoDigest(video.target));
}

function objectKey(item: ThreadsQueueItem): string {
  if (!item.video || !/^thread-video-[a-f\d-]{36}$/.test(item.id) || !/^[a-f\d]{64}$/.test(item.video.target.sha256)) {
    return fault("This Threads video has no verified local booking.");
  }
  return `threads/video/${item.id}/${item.video.target.sha256}.mp4`;
}

export async function stageThreadsVideo(item: ThreadsQueueItem): Promise<string> {
  const storage = videoDeliveryProfile();
  if (!storage || !item.video || !videoBookingMatches(item)) return fault("Approved private Threads video hosting is unavailable.");
  const { target } = item.video;
  const key = objectKey(item);
  const artifact = await readThreadsExport(target.jobId, target.fileName);
  if (artifact.sha256 !== target.sha256) return fault("The MP4 bytes changed after review. Choose and approve the new export.");
  try {
    const host = new S3MediaHost(storage);
    await host.putObjectBytes(key, artifact.bytes, "video/mp4");
    return await host.presignedGetUrl(key, FETCH_URL_SECONDS);
  } catch {
    return fault("The approved MP4 could not be prepared in the private Threads media bucket.");
  }
}

export async function cleanupThreadsVideo(item: ThreadsQueueItem): Promise<void> {
  const storage = videoDeliveryProfile();
  if (storage) await new S3MediaHost(storage).deleteObject(objectKey(item));
}
