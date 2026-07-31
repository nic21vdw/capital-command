"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { windowSegments } from "@/lib/clipping/captions";
import { leadingSilenceSec } from "@/lib/clipping/editor";
import { hasEditsBeyondAutoRender, renderSignature } from "@/lib/clipping/export-signature";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";
import { placeChannelVideos, type ChannelPlacement } from "@/lib/publisher/channelPlacement";
import type { ChannelSchedule, ChannelVideo } from "@/lib/publisher/channelVideos";
import type { RevisePatch } from "@/lib/publisher/revise";
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

export type ConnectedProfile = { title: string; thumbnail: string | null };

/** One connectable social account (see /api/publish/accounts). */
export type SocialAccountView = {
  id: string;
  platform: PlatformId;
  label: string;
  createdAt: string;
  /** The platform's built-in account backed by today's .env credentials. */
  primary: boolean;
  /** True when posts for this account publish automatically. */
  connected: boolean;
  /** Connected YouTube channel's name/avatar, when known. */
  youtube: ConnectedProfile | null;
  /** Connected TikTok profile's display name/avatar, when known. */
  tiktok: ConnectedProfile | null;
};

export function primaryAccountIdFor(platform: PlatformId): string {
  return `${platform}-primary`;
}

export type Overview = {
  enabled: boolean;
  timezone: string;
  platforms: Record<PlatformId, { configured: boolean; account?: ConnectedProfile | null }>;
  quota: YoutubeQuota;
  /** Which window the slots below belong to, in days after today. */
  slotOffsetDays: number;
  slots: ScheduleSlot[];
};

/** The schedule grid always shows a two-week window. */
export const SLOT_WINDOW_DAYS = 14;

/**
 * Where the default window starts, in days before today, so the calendar opens
 * on roughly the last week plus the next week — recent uploads and history land
 * on their days right away instead of hiding in a list, and today sits near the
 * middle. Paging steps by SLOT_WINDOW_DAYS from here in either direction.
 */
export const DEFAULT_SLOT_OFFSET_DAYS = -7;

export type ReadyClip = {
  /** Stable key: jobId + the exact output file that would be posted. */
  key: string;
  jobId: string;
  /** Backend clip-candidate id, used to persist title edits via PATCH. */
  clipId: string;
  /** File name inside the job's output folder (the ready-to-post render). */
  file: string;
  /** Every file this clip has ever been postable as, for queue matching. */
  allFiles: string[];
  headline: string;
  durationSec: number;
  thumbnailUrl: string;
  previewUrl: string;
  /** Dead air the clip opens on, in seconds; previews seek past it. */
  startSec: number;
  /**
   * True when a saved Clip Editor project for this clip has a trim (or other
   * edits) that its current render doesn't reflect — because it was never
   * rendered, or was trimmed again after its last render. Scheduling doesn't
   * block on this: it bakes the edits into a fresh render first (see
   * `schedule`), so the uploaded file is always the edited cut.
   */
  needsRerender: boolean;
  /**
   * The backend clip's source (master) file — the key its Clip Editor project
   * is saved against. Used to find the project to bake when `needsRerender`.
   */
  masterFile?: string;
};

/** Resolve a milliseconds delay without pulling in a timer library. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renders a clip project to completion and returns the output file name, so a
 * clip whose trim isn't baked in yet can be rendered right before it's posted —
 * guaranteeing the uploaded file is the edited cut without a trip to the editor.
 * Throws with a human-readable message on any render failure.
 */
async function bakeProject(project: ClipProject): Promise<string> {
  const startRes = await fetch(`/api/clips/${project.jobId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project)
  });
  if (!startRes.ok) throw new Error(await readError(startRes));
  const { export: rec } = (await startRes.json()) as { export?: { id: string } };
  if (!rec?.id) throw new Error("The render could not start.");
  // Poll the shared export record until it finishes. Bounded so a wedged render
  // can never hang the schedule action forever (10 min at a 1.2s cadence).
  for (let i = 0; i < 500; i += 1) {
    await delay(1200);
    const res = await fetch(`/api/clips/${project.jobId}/export/${rec.id}`, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) throw new Error("The render was lost after a server restart — try again.");
      continue; // transient blip — keep polling
    }
    const { export: state } = (await res.json()) as {
      export?: { status: string; file?: string; error?: string };
    };
    if (!state) continue;
    if (state.status === "done") {
      if (!state.file) throw new Error("The render finished but produced no file.");
      return state.file;
    }
    if (state.status === "error") throw new Error(state.error ?? "The render failed.");
    if (state.status === "canceled") throw new Error("The render was canceled.");
  }
  throw new Error("The render is taking too long — check the Clip Editor and try again.");
}

/**
 * Whether a clip's ready-to-post file is out of date with its saved editor
 * project — i.e. the current trim/edits haven't been baked into a render yet,
 * so uploading now would post the wrong cut.
 */
function computeNeedsRerender(clip: ClipCandidate, projects: ClipProject[]): boolean {
  if (!clip.file) return false;
  const project = projects
    .filter((candidate) => candidate.sourceFile === clip.file)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!project) return false;
  if (clip.editedFile) {
    // A render exists — stale only if the project changed since it was made.
    // Legacy renders carry no signature; leave those alone to avoid false alarms.
    if (!clip.editedSignature) return false;
    return renderSignature({ ...project, settings: project.exportSettings }) !== clip.editedSignature;
  }
  // No render at all: flag only edits the auto render can't already contain
  // (a real trim, added overlays, a watermark).
  return hasEditsBeyondAutoRender({ ...project, settings: project.exportSettings });
}

export type ClipDraft = {
  title: string;
  caption: string;
  platform: PlatformId;
  slotUtc: string;
};

const DEFAULT_ACTIVE_ACCOUNTS: Record<PlatformId, string> = {
  youtube: primaryAccountIdFor("youtube"),
  tiktok: primaryAccountIdFor("tiktok"),
  instagram: primaryAccountIdFor("instagram"),
  facebook: primaryAccountIdFor("facebook")
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook"
};

// Keep in sync with the Clip Generator's headline: the creator/auto title on
// the backend clip wins, then the hook quote, then a quote from the rationale.
function clipHeadline(clip: ClipCandidate, index: number) {
  if (clip.title) return clip.title;
  if (clip.hookQuote) return clip.hookQuote;
  const quoted = clip.rationale.match(/"([^"]{8,90})"/);
  return quoted?.[1] ?? `Clip ${index + 1}`;
}

/**
 * The queue stores repo-relative paths (possibly with Windows separators).
 * When a landscape clip was re-rendered vertical at enqueue time, clipPath is
 * the derived render and sourceClipPath is the file the card knows about.
 * Matches against every file the clip was ever postable as (master, ready
 * render, editor export, on-demand vertical), so items scheduled before the
 * clip was edited still show on its card.
 */
function itemMatchesClip(item: QueueItem, clip: ReadyClip): boolean {
  return [item.clipPath, item.sourceClipPath].some((candidate) => {
    if (!candidate) return false;
    const normalized = candidate.replace(/\\/g, "/");
    return clip.allFiles.some(
      (file) => normalized.endsWith(`/${clip.jobId}/${file}`) || (item.jobId === clip.jobId && normalized.endsWith(`/${file}`))
    );
  });
}

/** All postable file names for a backend clip, most-preferred first. */
function clipFiles(clip: ClipCandidate): string[] {
  const files = [clip.editedFile, clip.downloadFile, clip.file].filter((file): file is string => Boolean(file));
  // The publish API converts a widescreen master to `<name>-vertical.mp4`
  // on the fly; recognize those queue entries as this clip's too.
  for (const file of [...files]) {
    files.push(`${file.replace(/\.[^.]+$/, "")}-vertical.mp4`);
  }
  return files;
}

export function remoteUrlFor(platform: PlatformId, postId: string | undefined): string | null {
  if (!postId) return null;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${postId}`;
  return null;
}

/** The channel's "Content" page in YouTube Studio (Studio home when unknown). */
export function studioContentUrl(channelId: string | null | undefined): string {
  return channelId ? `https://studio.youtube.com/channel/${channelId}/videos` : "https://studio.youtube.com";
}

/** One video's edit page in YouTube Studio (title, description, thumbnail…). */
export function studioVideoUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

/** What the post-upload confirmation dialog shows after a YouTube upload. */
export type UploadSuccess = {
  title: string;
  videoUrl: string;
  status: "scheduled" | "published";
  /** Go-live instant, UTC ISO-8601. */
  publishAt: string;
  /** YouTube video id, for the Studio edit-page button. */
  postId?: string;
};

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // Non-JSON error body.
  }
  return `Request failed (${response.status}).`;
}

export function useUploadingCenter(clipProjects: ClipProject[] = []) {
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [channel, setChannel] = useState<ChannelSchedule | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountView[]>([]);
  /**
   * Which account each platform's tab (and calendar) is showing. Defaults to
   * every platform's primary account — the pre-multi-account behavior — so
   * everything already scheduled or uploaded stays right where it was.
   */
  const [activeAccountIds, setActiveAccountIds] = useState<Record<PlatformId, string>>(DEFAULT_ACTIVE_ACCOUNTS);
  const [loaded, setLoaded] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /** Key of the action in flight ("schedule:<clipKey>", "publish:<id>", …). */
  const [busy, setBusy] = useState<string | null>(null);
  /** Set right after a YouTube upload succeeds; drives the confirmation dialog. */
  const [uploadSuccess, setUploadSuccess] = useState<UploadSuccess | null>(null);
  const remindedRef = useRef(new Set<string>());
  /**
   * Which two-week window the schedule grid shows, in days after today
   * (0 = the current period, 14 = the next one, …). Changing it recreates
   * `refresh`, and the page's fetch effect re-runs with the new window.
   */
  const [slotOffsetDays, setSlotOffsetDays] = useState(DEFAULT_SLOT_OFFSET_DAYS);

  const activeYoutubeAccountId = activeAccountIds.youtube;
  const refresh = useCallback(async (options?: { channelRefresh?: boolean }) => {
    // Sequential local fetches; a failure keeps the last good data and the
    // 60s tick tries again.
    try {
      const jobsRes = await fetch("/api/clips", { cache: "no-store" });
      if (jobsRes.ok) setJobs(((await jobsRes.json()) as { jobs: ClipJob[] }).jobs);
      const queueRes = await fetch("/api/publish", { cache: "no-store" });
      if (queueRes.ok) setQueueItems(((await queueRes.json()) as { items?: QueueItem[] }).items ?? []);
      const overviewRes = await fetch(`/api/publish/overview?days=${SLOT_WINDOW_DAYS}&offsetDays=${slotOffsetDays}`, {
        cache: "no-store"
      });
      if (overviewRes.ok) setOverview((await overviewRes.json()) as Overview);
      const accountsRes = await fetch("/api/publish/accounts", { cache: "no-store" });
      if (accountsRes.ok) setAccounts(((await accountsRes.json()) as { accounts?: SocialAccountView[] }).accounts ?? []);
      // The channel schedule is cached 5 minutes server-side per account;
      // channelRefresh bypasses that right after a publish so the new video
      // appears at once. Reads the YouTube account selected on the tab.
      const channelParams = new URLSearchParams({ account: activeYoutubeAccountId });
      if (options?.channelRefresh) channelParams.set("refresh", "1");
      const channelRes = await fetch(`/api/publish/youtube-channel?${channelParams.toString()}`, {
        cache: "no-store"
      });
      if (channelRes.ok) setChannel((await channelRes.json()) as ChannelSchedule);
    } catch {
      // Offline or malformed payload — retry on the next tick.
    } finally {
      setLoaded(true);
    }
  }, [activeYoutubeAccountId, slotOffsetDays]);

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
        .filter((job) => job.clips.some((clip) => clip.editedFile || clip.downloadFile || clip.file))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobs]
  );
  const activeJob = useMemo(
    () => jobsWithClips.find((job) => job.id === activeJobId) ?? jobsWithClips[0] ?? null,
    [activeJobId, jobsWithClips]
  );

  const readyClips = useMemo<ReadyClip[]>(() => {
    if (!activeJob) return [];
    const projectsForJob = clipProjects.filter((project) => project.jobId === activeJob.id);
    return activeJob.clips.flatMap((clip, index) => {
      // Prefer the Clip Editor's export (the edited clip IS the clip), then
      // the ready-to-post vertical render; the master is a last resort and
      // the publish API re-renders it vertical before anything is posted.
      const file = clip.editedFile ?? clip.downloadFile ?? clip.file;
      if (!file) return [];
      const thumbSource = clip.file ?? file;
      // The auto renders (downloadFile / master) share the clip's source
      // timeline, so the clip-local transcript tells us how much dead air it
      // opens on. An edited export has its own trim, so we never second-guess
      // where the user set its start.
      const startSec = clip.editedFile
        ? 0
        : leadingSilenceSec(windowSegments(activeJob.sourceCaptions ?? [], clip.start, clip.end));
      return [
        {
          key: `${activeJob.id}/${file}`,
          jobId: activeJob.id,
          clipId: clip.id,
          file,
          allFiles: clipFiles(clip),
          headline: clipHeadline(clip, index),
          durationSec: Math.max(0, Math.round(clip.end - clip.start)),
          thumbnailUrl: clip.posterFile
            ? `/api/clips/${activeJob.id}/files/${encodeURIComponent(clip.posterFile)}`
            : `/api/clips/${activeJob.id}/thumbnail/${encodeURIComponent(thumbSource)}`,
          previewUrl: `/api/clips/${activeJob.id}/files/${encodeURIComponent(file)}`,
          startSec,
          needsRerender: computeNeedsRerender(clip, projectsForJob),
          masterFile: clip.file
        }
      ];
    });
  }, [activeJob, clipProjects]);

  /** Queue items that came from a given clip card. */
  const itemsForClip = useCallback(
    (clip: ReadyClip) => queueItems.filter((item) => itemMatchesClip(item, clip)),
    [queueItems]
  );

  /**
   * Poster-frame URL for a queue item, resolved through the clip job it came
   * from (CLI-enqueued items without a jobId have no preview). Prefers the
   * pre-rendered poster; falls back to on-demand frame extraction.
   */
  const thumbnailByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of queueItems) {
      if (!item.jobId) continue;
      const job = jobs.find((candidate) => candidate.id === item.jobId);
      if (!job) continue;
      const normalized = (item.sourceClipPath ?? item.clipPath).replace(/\\/g, "/");
      const clip = job.clips.find((candidate) =>
        clipFiles(candidate).some((file) => normalized.endsWith(`/${file}`))
      );
      if (!clip) continue;
      // The thumbnail endpoint only serves files the job produced (clip.file);
      // downloadFile renders aren't in that list.
      if (clip.posterFile) {
        map.set(item.id, `/api/clips/${job.id}/files/${encodeURIComponent(clip.posterFile)}`);
      } else if (clip.file) {
        map.set(item.id, `/api/clips/${job.id}/thumbnail/${encodeURIComponent(clip.file)}`);
      }
    }
    return map;
  }, [jobs, queueItems]);
  const thumbnailForItem = useCallback((item: QueueItem) => thumbnailByItemId.get(item.id) ?? null, [thumbnailByItemId]);

  /** The account a queue item belongs to on a platform (legacy items → primary). */
  const itemAccountIdFor = useCallback(
    (item: QueueItem, platform: PlatformId) => item.accountId ?? primaryAccountIdFor(platform),
    []
  );

  /**
   * Occupied slots per platform, keyed by the slot's UTC instant — only for
   * the account each platform's tab is showing, so every account gets its own
   * calendar and two accounts can post at the same slot time.
   */
  const itemsByPlatformSlot = useMemo(() => {
    const map = new Map<PlatformId, Map<string, QueueItem>>();
    for (const item of queueItems) {
      const utc = new Date(item.publishAt).toISOString();
      for (const platform of Object.keys(item.platforms) as PlatformId[]) {
        if (itemAccountIdFor(item, platform) !== activeAccountIds[platform]) continue;
        if (!map.has(platform)) map.set(platform, new Map());
        map.get(platform)!.set(utc, item);
      }
    }
    return map;
  }, [activeAccountIds, itemAccountIdFor, queueItems]);

  /**
   * Every queue item for the account each platform's tab is showing, keyed by
   * platform (not by slot) — the calendar places each on the day it goes live,
   * whether or not its time lines up with a slot.
   */
  const itemsByPlatform = useMemo(() => {
    const map = new Map<PlatformId, QueueItem[]>();
    for (const item of queueItems) {
      for (const platform of Object.keys(item.platforms) as PlatformId[]) {
        if (itemAccountIdFor(item, platform) !== activeAccountIds[platform]) continue;
        let bucket = map.get(platform);
        if (!bucket) {
          bucket = [];
          map.set(platform, bucket);
        }
        bucket.push(item);
      }
    }
    return map;
  }, [activeAccountIds, itemAccountIdFor, queueItems]);

  /**
   * Queue items visible under the current account selection: at least one of
   * the item's platforms is showing the account the item belongs to.
   */
  const visibleQueueItems = useMemo(
    () =>
      queueItems.filter((item) =>
        (Object.keys(item.platforms) as PlatformId[]).some(
          (platform) => itemAccountIdFor(item, platform) === activeAccountIds[platform]
        )
      ),
    [activeAccountIds, itemAccountIdFor, queueItems]
  );

  /**
   * Persists a title edit on the backend clip so it survives navigation and
   * shows up identically in the Clip Generator and Clip Editor. A blank title
   * clears the custom title back to the auto-derived headline.
   */
  const renameClip = useCallback(
    async (clip: ReadyClip, title: string) => {
      const trimmed = title.trim();
      // Optimistic: reflect the new title in the local jobs immediately.
      setJobs((prev) =>
        prev.map((job) =>
          job.id === clip.jobId
            ? {
                ...job,
                clips: job.clips.map((candidate) =>
                  candidate.id === clip.clipId ? { ...candidate, title: trimmed || undefined } : candidate
                )
              }
            : job
        )
      );
      try {
        const response = await fetch(`/api/clips/${clip.jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clipId: clip.clipId, clipTitle: trimmed })
        });
        if (!response.ok) throw new Error(await readError(response));
      } catch {
        toast.error("Could not save the clip title.");
        await refresh();
      }
    },
    [refresh]
  );

  /**
   * Renames a scheduled post right on the calendar. The backend saves the new
   * title on the queue item and — when the video is already up on YouTube —
   * renames it there too via the Data API, so the calendar and the channel
   * never disagree.
   */
  const renameQueueItem = useCallback(
    async (item: QueueItem, title: string) => {
      const trimmed = title.trim().slice(0, 100);
      if (!trimmed || trimmed === item.title) return;
      // Optimistic: show the new title immediately; revert via refresh on error.
      setQueueItems((prev) => prev.map((candidate) => (candidate.id === item.id ? { ...candidate, title: trimmed } : candidate)));
      try {
        const response = await fetch(`/api/publish/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed })
        });
        if (!response.ok) throw new Error(await readError(response));
        const { youtube, youtubeError } = (await response.json()) as { youtube?: string; youtubeError?: string };
        if (youtube === "updated") {
          toast.success("Title updated on YouTube.");
        } else if (youtube === "error") {
          toast.warning(`Title saved here, but YouTube didn't take it: ${youtubeError ?? "unknown error"}`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not rename the post.");
        await refresh();
      }
    },
    [refresh]
  );

  /**
   * Videos that live on the YouTube channel itself, minus the ones this queue
   * created — those already render as queue items (matched by video id).
   */
  const channelVideos = useMemo<ChannelVideo[]>(() => {
    if (!channel) return [];
    const ownPostIds = new Set(
      queueItems.map((item) => item.platforms.youtube?.postId).filter((id): id is string => Boolean(id))
    );
    return channel.videos.filter((video) => !ownPostIds.has(video.videoId));
  }, [channel, queueItems]);

  /**
   * The channel's videos placed onto the visible grid: slot occupants (times
   * on or within a few minutes of a slot), per-day markers for videos at any
   * other time that day, and the rest outside the window. This is what stops
   * a slot — or a whole day — from being double-booked against what is
   * already scheduled on YouTube itself.
   */
  const channelPlacement = useMemo<ChannelPlacement>(() => {
    const youtubeItems = itemsByPlatformSlot.get("youtube");
    return placeChannelVideos({
      videos: channelVideos,
      slots: overview?.slots ?? [],
      isSlotOccupied: (slotUtc) => Boolean(youtubeItems?.has(slotUtc)),
      timeZone: overview?.timezone ?? "UTC"
    });
  }, [channelVideos, itemsByPlatformSlot, overview]);

  /**
   * Surfaces the result of a successful enqueue response (from /api/publish
   * or /api/publish/upload — both return the same shape). The backend uploads
   * YouTube posts right away (private + publishAt, so the video shows as
   * Scheduled in YouTube Studio) and reports how that went; TikTok/Instagram
   * just queue.
   */
  const announceScheduleOutcome = useCallback(async (response: Response, platform: PlatformId) => {
    const { item, report } = (await response.json()) as {
      item?: QueueItem;
      report?: { outcomes: Array<{ platform: string; outcome: string; detail: string }> };
    };
    const outcome = report?.outcomes.find((entry) => entry.platform === platform);
    const postId = platform === "youtube" ? item?.platforms.youtube?.postId : undefined;
    const videoUrl = remoteUrlFor(platform, postId);
    if ((outcome?.outcome === "scheduled" || outcome?.outcome === "published") && item && videoUrl) {
      // The confirmation dialog (video link + YouTube Studio button)
      // replaces the plain toast for a completed YouTube upload.
      setUploadSuccess({ title: item.title, videoUrl, status: outcome.outcome, publishAt: item.publishAt, postId });
    } else if (outcome?.outcome === "scheduled") {
      toast.success("Uploaded to YouTube — it now shows as Scheduled on your channel.");
    } else if (outcome?.outcome === "published") {
      toast.success(`Published to ${PLATFORM_LABELS[platform]}.`);
    } else if (
      platform === "youtube" &&
      outcome?.outcome === "failed" &&
      outcome.detail.includes("YouTube connection expired")
    ) {
      const accountId = item?.accountId ?? primaryAccountIdFor("youtube");
      toast.error("Your YouTube connection expired. Reconnect once and Command will resume this upload automatically.", {
        duration: Infinity,
        action: {
          label: "Reconnect YouTube",
          onClick: () => {
            window.location.href = `/api/auth/google?account=${encodeURIComponent(accountId)}`;
          }
        }
      });
    } else if (outcome?.outcome === "retrying") {
      toast.warning(`Upload interrupted — Command will retry automatically. ${outcome.detail || ""}`.trim());
    } else if (outcome?.outcome === "failed") {
      toast.error(`Upload failed: ${outcome.detail || "The platform rejected the upload."}`);
    } else {
      toast.success(`Scheduled for ${PLATFORM_LABELS[platform]}.`);
    }
  }, []);

  /**
   * The clip's most recently edited Clip Editor project, used to bake its trim
   * into a render right before scheduling. Matched on the clip's master file,
   * the key projects are saved against (see computeNeedsRerender).
   */
  const projectForClip = useCallback(
    (clip: ReadyClip): ClipProject | null => {
      if (!clip.masterFile) return null;
      return (
        clipProjects
          .filter((project) => project.jobId === clip.jobId && project.sourceFile === clip.masterFile)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
      );
    },
    [clipProjects]
  );

  /**
   * Tailors a clip's caption + hashtags to the platform its draft targets via
   * the free AI provider (DeepSeek Flash by default). Returns the platform-ready
   * caption (hashtags appended) plus a best-time hint, or null on failure. The
   * caller writes the returned caption into the draft — this never mutates it.
   */
  const tailorCaption = useCallback(
    async (
      clip: ReadyClip,
      platform: PlatformId,
      title: string
    ): Promise<{ caption: string; bestTime?: string; note?: string } | null> => {
      setBusy(`tailor:${clip.key}`);
      try {
        const response = await fetch("/api/publish/ai-copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: clip.jobId,
            clipId: clip.clipId,
            platform,
            title: title.trim() || undefined
          })
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return null;
        }
        const { copy } = (await response.json()) as {
          copy: { caption: string; hashtags: string[]; bestTime?: string; note?: string };
        };
        const caption = copy.hashtags.length ? `${copy.caption}\n\n${copy.hashtags.join(" ")}` : copy.caption;
        return { caption, bestTime: copy.bestTime, note: copy.note };
      } catch {
        toast.error("Couldn't tailor the caption — try again.");
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const schedule = useCallback(
    async (clip: ReadyClip, draft: ClipDraft) => {
      if (!draft.slotUtc) {
        toast.error("Pick a schedule slot first.");
        return false;
      }
      setBusy(`schedule:${clip.key}`);
      try {
        // If the trim/edits aren't baked into the current render, render them
        // now and post the fresh cut — so the upload is always the edited clip,
        // no round-trip through the editor required.
        let file = clip.file;
        if (clip.needsRerender) {
          const project = projectForClip(clip);
          if (!project) {
            toast.error("Open this clip in the editor and hit Schedule Short to bake in your edits first.");
            return false;
          }
          const bakeToast = toast.loading("Baking your trim before scheduling…");
          try {
            file = await bakeProject(project);
          } catch (error) {
            toast.error(`Couldn't render the trimmed clip: ${error instanceof Error ? error.message : "render failed"}.`, {
              id: bakeToast
            });
            return false;
          }
          toast.dismiss(bakeToast);
        }
        const response = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: clip.jobId,
            file,
            publishAt: draft.slotUtc,
            title: draft.title.trim() || undefined,
            caption: draft.caption.trim() || undefined,
            platforms: [draft.platform],
            // "public" is what makes YouTube honor publishAt: the video is
            // uploaded private and YouTube flips it live at the slot time.
            visibility: "public",
            // The post lands on the account the platform's tab is showing.
            accountId: activeAccountIds[draft.platform]
          })
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        await announceScheduleOutcome(response, draft.platform);
        await refresh({ channelRefresh: draft.platform === "youtube" });
        return true;
      } finally {
        setBusy(null);
      }
    },
    [activeAccountIds, announceScheduleOutcome, projectForClip, refresh]
  );

  /**
   * Schedules a video that never went through the clip generator: streams the
   * file the user dropped (or picked) on a slot to the backend, which stores
   * it and enqueues it exactly like a clip — vertical re-render, generated
   * title/caption, and the immediate YouTube upload all included.
   */
  const uploadToSlot = useCallback(
    async (file: File, draft: { platform: PlatformId; slotUtc: string }) => {
      setBusy(`upload:${draft.platform}:${draft.slotUtc}`);
      try {
        const params = new URLSearchParams({
          name: file.name,
          publishAt: draft.slotUtc,
          platform: draft.platform,
          accountId: activeAccountIds[draft.platform]
        });
        const response = await fetch(`/api/publish/upload?${params.toString()}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "video/mp4" },
          body: file
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        await announceScheduleOutcome(response, draft.platform);
        await refresh({ channelRefresh: draft.platform === "youtube" });
        return true;
      } catch {
        toast.error("Network error while uploading the video.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [activeAccountIds, announceScheduleOutcome, refresh]
  );

  /**
   * Batch form of `schedule` for the Auto Assign button: each clip arrives
   * pre-paired with a free slot. Posts sequentially (the queue store isn't
   * safe under concurrent writes), summarizes in one toast, refreshes once.
   */
  const autoAssign = useCallback(
    async (assignments: Array<{ clip: ReadyClip; draft: ClipDraft }>) => {
      if (assignments.length === 0) return;
      setBusy("auto-assign");
      let scheduled = 0;
      let firstError: string | null = null;
      try {
        for (const { clip, draft } of assignments) {
          let file = clip.file;
          if (clip.needsRerender) {
            const project = projectForClip(clip);
            if (!project) {
              firstError ??= "Some clips need editing in the Clip Editor before they can be scheduled.";
              continue;
            }
            try {
              file = await bakeProject(project);
            } catch (error) {
              firstError ??= `Couldn't render a trimmed clip: ${error instanceof Error ? error.message : "render failed"}.`;
              continue;
            }
          }
          try {
            const response = await fetch("/api/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId: clip.jobId,
                file,
                publishAt: draft.slotUtc,
                title: draft.title.trim() || undefined,
                caption: draft.caption.trim() || undefined,
                platforms: [draft.platform],
                visibility: "public",
                accountId: activeAccountIds[draft.platform]
              })
            });
            if (!response.ok) {
              firstError ??= await readError(response);
              continue;
            }
            scheduled += 1;
          } catch {
            firstError ??= "Network error while scheduling.";
          }
        }
        if (scheduled === assignments.length) {
          toast.success(`Auto-assigned ${scheduled} clip${scheduled === 1 ? "" : "s"} to the next open slots.`);
        } else if (scheduled > 0) {
          toast.warning(
            `Auto-assigned ${scheduled} of ${assignments.length} clips${firstError ? ` — ${firstError}` : "."}`
          );
        } else {
          toast.error(firstError ?? "Auto assign failed.");
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [activeAccountIds, projectForClip, refresh]
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
        await refresh({ channelRefresh: true });
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

  /**
   * Change a scheduled post — its time, copy, visibility, account or targets.
   * The server decides what is allowed (a post already on a platform can only
   * be renamed) and answers 409 with a sentence explaining why, which is what
   * the toast shows.
   */
  const revise = useCallback(
    async (item: QueueItem, patch: RevisePatch) => {
      setBusy(`revise:${item.id}`);
      try {
        const response = await fetch(`/api/publish/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        const result = (await response.json()) as { youtube?: string; youtubeError?: string };
        if (result.youtube === "error") toast.warning(`Saved here, but YouTube said: ${result.youtubeError}`);
        else toast.success("Post updated.");
        await refresh({ channelRefresh: result.youtube === "updated" });
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  /** Take a post out of the running without losing the clip or the copy. */
  const skip = useCallback(
    async (item: QueueItem) => {
      setBusy(`skip:${item.id}`);
      try {
        const response = await fetch(`/api/publish/${item.id}/skip`, { method: "POST" });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        toast.success("Skipped — it stays on the day but won't post.");
        await refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  /** Move a whole day's still-movable posts. Reports what could not move. */
  const shiftDayBy = useCallback(
    async (dateKey: string, minutes: number) => {
      setBusy(`shift:${dateKey}`);
      try {
        const response = await fetch("/api/publish/shift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateKey, minutes })
        });
        const result = (await response.json()) as {
          moved?: number;
          blocked?: { title: string; reason: string }[];
          error?: string;
        };
        if (!response.ok) {
          toast.error(result.error ?? "Couldn't move that day.");
          return false;
        }
        const direction = minutes > 0 ? "later" : "earlier";
        const blocked = result.blocked ?? [];
        toast.success(
          `Moved ${result.moved} post${result.moved === 1 ? "" : "s"} ${Math.abs(minutes)} min ${direction}` +
            (blocked.length > 0 ? ` · left ${blocked.length} alone (${blocked[0].reason})` : "")
        );
        await refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  /** A platform's accounts, primary first (the API returns them ordered). */
  const accountsFor = useCallback(
    (platform: PlatformId) => accounts.filter((account) => account.platform === platform),
    [accounts]
  );

  /** The account a platform's tab is currently showing. */
  const activeAccountFor = useCallback(
    (platform: PlatformId) =>
      accounts.find((account) => account.id === activeAccountIds[platform]) ?? null,
    [accounts, activeAccountIds]
  );

  const setActiveAccount = useCallback((platform: PlatformId, accountId: string) => {
    setActiveAccountIds((current) => ({ ...current, [platform]: accountId }));
  }, []);

  /** Adds an account and switches the platform's tab straight to it. */
  const addAccount = useCallback(
    async (platform: PlatformId, label: string) => {
      setBusy(`add-account:${platform}`);
      try {
        const response = await fetch("/api/publish/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, label })
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        const { account } = (await response.json()) as { account: SocialAccountView };
        setAccounts((current) => [...current, account]);
        setActiveAccount(platform, account.id);
        toast.success(`Added ${PLATFORM_LABELS[platform]} account "${account.label}".`);
        await refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh, setActiveAccount]
  );

  const removeAccount = useCallback(
    async (account: SocialAccountView) => {
      setBusy(`remove-account:${account.id}`);
      try {
        const response = await fetch(`/api/publish/accounts/${account.id}`, { method: "DELETE" });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        setActiveAccount(account.platform, primaryAccountIdFor(account.platform));
        toast.success(`Removed account "${account.label}".`);
        await refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh, setActiveAccount]
  );

  return {
    loaded,
    overview,
    slotOffsetDays,
    setSlotOffsetDays,
    /** True while the slots on screen still belong to the previous window. */
    slotWindowLoading: overview !== null && (overview.slotOffsetDays ?? 0) !== slotOffsetDays,
    channel,
    channelVideos,
    channelVideosBySlot: channelPlacement.bySlotUtc,
    channelDayMarkers: channelPlacement.dayMarkers,
    channelVideosOutsideWindow: channelPlacement.outsideWindow,
    queueItems,
    visibleQueueItems,
    accounts,
    activeAccountIds,
    accountsFor,
    activeAccountFor,
    setActiveAccount,
    addAccount,
    removeAccount,
    jobsWithClips,
    activeJob,
    setActiveJobId,
    readyClips,
    itemsForClip,
    itemsByPlatformSlot,
    itemsByPlatform,
    thumbnailForItem,
    busy,
    uploadSuccess,
    dismissUploadSuccess: () => setUploadSuccess(null),
    renameClip,
    renameQueueItem,
    tailorCaption,
    schedule,
    uploadToSlot,
    autoAssign,
    publishNow,
    remove,
    revise,
    skip,
    shiftDayBy,
    refresh
  };
}
