"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { YoutubeQuota } from "@/lib/publisher/quota";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * Data layer for the Uploading Center. The front end only ever talks to the
 * local backend — never to Google or any platform API — and no token or
 * secret ever reaches the browser. The 60-second poll doubles as the
 * TikTok/Instagram manual-post reminder tick (YouTube self-publishes, so it
 * needs no tick at all); it is a no-op when nothing is due.
 */

export type YoutubeAccount = { title: string; thumbnail: string | null };

export type Overview = {
  enabled: boolean;
  timezone: string;
  platforms: Record<PlatformId, { configured: boolean; account?: YoutubeAccount | null }>;
  quota: YoutubeQuota;
  slots: ScheduleSlot[];
};

export type ReadyClip = {
  /** Stable key: jobId + the exact output file that would be posted. */
  key: string;
  jobId: string;
  /** File name inside the job's output folder (the ready-to-post render). */
  file: string;
  headline: string;
  durationSec: number;
  thumbnailUrl: string;
  previewUrl: string;
};

export type ClipDraft = {
  title: string;
  caption: string;
  platform: PlatformId;
  slotUtc: string;
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram"
};

function clipHeadline(clip: ClipCandidate, index: number) {
  if (clip.hookQuote) return clip.hookQuote;
  const quoted = clip.rationale.match(/"([^"]{8,90})"/);
  return quoted?.[1] ?? `Clip ${index + 1}`;
}

/** The queue stores repo-relative paths (possibly with Windows separators). */
function itemMatchesClip(item: QueueItem, clip: ReadyClip): boolean {
  const normalized = item.clipPath.replace(/\\/g, "/");
  return normalized.endsWith(`/${clip.jobId}/${clip.file}`) || (item.jobId === clip.jobId && normalized.endsWith(`/${clip.file}`));
}

export function remoteUrlFor(platform: PlatformId, postId: string | undefined): string | null {
  if (!postId) return null;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${postId}`;
  return null;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // Non-JSON error body.
  }
  return `Request failed (${response.status}).`;
}

export function useUploadingCenter() {
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /** Key of the action in flight ("schedule:<clipKey>", "publish:<id>", …). */
  const [busy, setBusy] = useState<string | null>(null);
  const remindedRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    // Sequential local fetches; a failure keeps the last good data and the
    // 60s tick tries again.
    try {
      const jobsRes = await fetch("/api/clips", { cache: "no-store" });
      if (jobsRes.ok) setJobs(((await jobsRes.json()) as { jobs: ClipJob[] }).jobs);
      const queueRes = await fetch("/api/publish", { cache: "no-store" });
      if (queueRes.ok) setQueueItems(((await queueRes.json()) as { items?: QueueItem[] }).items ?? []);
      const overviewRes = await fetch("/api/publish/overview?days=14", { cache: "no-store" });
      if (overviewRes.ok) setOverview((await overviewRes.json()) as Overview);
    } catch {
      // Offline or malformed payload — retry on the next tick.
    } finally {
      setLoaded(true);
    }
  }, []);

  // NOTE: the initial fetch + 60s poll effect lives in UploadingCenterPage —
  // react-hooks/set-state-in-effect flags `void refresh()` inside a custom
  // hook (but not inside a component), so the component owns the timer.

  // Manual-post reminders: once a TikTok/Instagram assignment's time arrives,
  // surface it exactly once per platform. Safe with zero due jobs.
  useEffect(() => {
    const now = Date.now();
    for (const item of queueItems) {
      if (new Date(item.publishAt).getTime() > now) continue;
      for (const [platform, state] of Object.entries(item.platforms)) {
        if (!state || state.status !== "manual") continue;
        const key = `${item.id}:${platform}`;
        if (remindedRef.current.has(key)) continue;
        remindedRef.current.add(key);
        toast.warning(`Time to post "${item.title}" to ${PLATFORM_LABELS[platform as PlatformId]} manually.`);
      }
    }
  }, [queueItems]);

  const jobsWithClips = useMemo(
    () =>
      jobs
        .filter((job) => job.clips.some((clip) => clip.downloadFile || clip.file))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobs]
  );
  const activeJob = useMemo(
    () => jobsWithClips.find((job) => job.id === activeJobId) ?? jobsWithClips[0] ?? null,
    [activeJobId, jobsWithClips]
  );

  const readyClips = useMemo<ReadyClip[]>(() => {
    if (!activeJob) return [];
    return activeJob.clips.flatMap((clip, index) => {
      // Prefer the ready-to-post vertical render; fall back to the master.
      const file = clip.downloadFile ?? clip.file;
      if (!file) return [];
      const thumbSource = clip.file ?? file;
      return [
        {
          key: `${activeJob.id}/${file}`,
          jobId: activeJob.id,
          file,
          headline: clipHeadline(clip, index),
          durationSec: Math.max(0, Math.round(clip.end - clip.start)),
          thumbnailUrl: clip.posterFile
            ? `/api/clips/${activeJob.id}/files/${encodeURIComponent(clip.posterFile)}`
            : `/api/clips/${activeJob.id}/thumbnail/${encodeURIComponent(thumbSource)}`,
          previewUrl: `/api/clips/${activeJob.id}/files/${encodeURIComponent(file)}`
        }
      ];
    });
  }, [activeJob]);

  /** Queue items that came from a given clip card. */
  const itemsForClip = useCallback(
    (clip: ReadyClip) => queueItems.filter((item) => itemMatchesClip(item, clip)),
    [queueItems]
  );

  /** Occupied slots per platform, keyed by the slot's UTC instant. */
  const itemsByPlatformSlot = useMemo(() => {
    const map = new Map<PlatformId, Map<string, QueueItem>>();
    for (const item of queueItems) {
      const utc = new Date(item.publishAt).toISOString();
      for (const platform of Object.keys(item.platforms) as PlatformId[]) {
        if (!map.has(platform)) map.set(platform, new Map());
        map.get(platform)!.set(utc, item);
      }
    }
    return map;
  }, [queueItems]);

  const schedule = useCallback(
    async (clip: ReadyClip, draft: ClipDraft) => {
      if (!draft.slotUtc) {
        toast.error("Pick a schedule slot first.");
        return false;
      }
      setBusy(`schedule:${clip.key}`);
      try {
        const response = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: clip.jobId,
            file: clip.file,
            publishAt: draft.slotUtc,
            title: draft.title.trim() || undefined,
            caption: draft.caption.trim() || undefined,
            platforms: [draft.platform],
            // "public" is what makes YouTube honor publishAt: the video is
            // uploaded private and YouTube flips it live at the slot time.
            visibility: "public"
          })
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        toast.success(`Scheduled for ${PLATFORM_LABELS[draft.platform]}.`);
        await refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const publishNow = useCallback(
    async (item: QueueItem) => {
      setBusy(`publish:${item.id}`);
      try {
        const response = await fetch(`/api/publish/${item.id}/publish`, { method: "POST" });
        if (!response.ok) {
          toast.error(await readError(response));
          return;
        }
        const { report } = (await response.json()) as {
          report: { outcomes: Array<{ platform: string; outcome: string; detail: string }> };
        };
        for (const outcome of report.outcomes) {
          const line = `${PLATFORM_LABELS[outcome.platform as PlatformId]}: ${outcome.outcome}`;
          if (outcome.outcome === "failed") toast.error(`${line} — ${outcome.detail}`);
          else toast.success(line);
        }
        if (report.outcomes.length === 0) toast.info("Nothing left to publish on that post.");
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (item: QueueItem) => {
      setBusy(`remove:${item.id}`);
      try {
        const response = await fetch(`/api/publish/${item.id}`, { method: "DELETE" });
        if (!response.ok) toast.error(await readError(response));
        else toast.success("Removed from the schedule.");
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  return {
    loaded,
    overview,
    queueItems,
    jobsWithClips,
    activeJob,
    setActiveJobId,
    readyClips,
    itemsForClip,
    itemsByPlatformSlot,
    busy,
    schedule,
    publishNow,
    remove,
    refresh
  };
}
