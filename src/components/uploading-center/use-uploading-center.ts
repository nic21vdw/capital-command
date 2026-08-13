"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { nameClips } from "@/components/uploading-center/bulk";
import { windowSegments } from "@/lib/clipping/captions";
import { loadJobCaptions } from "@/lib/clipping/captions-client";
import { leadingSilenceSec } from "@/lib/clipping/editor";
import { hasEditsBeyondAutoRender, renderSignature } from "@/lib/clipping/export-signature";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { CaptionSegment, ClipProject } from "@/types/domain";
import { placeChannelVideos, type ChannelPlacement } from "@/lib/publisher/channelPlacement";
import type { ChannelSchedule, ChannelVideo } from "@/lib/publisher/channelVideos";
import { generateSlots } from "@/lib/publisher/slots";
import type { YoutubeQuota } from "@/lib/publisher/quota";
import { ALL_PLATFORMS, type PlatformId, type QueueItem } from "@/lib/publisher/types";

/**
 * Data layer for the Uploading Center. The front end only ever talks to the
 * local backend — never to Google or any platform API — and no token or
 * secret ever reaches the browser. The 60-second poll doubles as the
 * TikTok/Instagram manual-post reminder tick (YouTube self-publishes, so it
 * needs no tick at all); it is a no-op when nothing is due.
 */

export type ConnectedProfile = { title: string; thumbnail: string | null; handle?: string | null };

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
  /** The profile behind this account, whichever platform minted it. */
  profile: ConnectedProfile | null;
  /** Connected, but something still stops it publishing unattended. */
  blocker: string | null;
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
  quota: YoutubeQuota;
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

/** Stable empty transcript, so a job without captions doesn't rebuild its clips. */
const NO_CAPTIONS: CaptionSegment[] = [];

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

/**
 * What a clip card is aimed at: one platform, or "all" — the same clip posted
 * to every platform at the same slot. "all" is expanded into one queue item per
 * platform at schedule time, never a single multi-platform item, because a
 * queue item carries exactly one accountId and each platform's tab has its own
 * active account (see `enqueue`).
 */
export const ALL_PLATFORMS_TARGET = "all";

export type PlatformTarget = PlatformId | typeof ALL_PLATFORMS_TARGET;

export function targetPlatforms(target: PlatformTarget): PlatformId[] {
  return target === ALL_PLATFORMS_TARGET ? [...ALL_PLATFORMS] : [target];
}

export type ClipDraft = {
  title: string;
  caption: string;
  platform: PlatformTarget;
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

export const PLATFORM_TARGET_LABELS: Record<PlatformTarget, string> = {
  all: "All platforms",
  ...PLATFORM_LABELS
};

/**
 * The platform whose copy an "all platforms" caption is written for. One
 * caption goes out to every platform, so it is tailored to the longest-form
 * of them rather than to a single short-form feed.
 */
export function copyPlatformFor(target: PlatformTarget): PlatformId {
  return target === ALL_PLATFORMS_TARGET ? "youtube" : target;
}

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

/** Either the platform-ready caption, or why it couldn't be written. */
export type TailoredCaption =
  | { ok: true; caption: string; bestTime?: string; note?: string }
  | { ok: false; error: string };

/** One clip a bulk caption pass could not write copy for, and why. */
export type CaptionFailure = { clip: ReadyClip; error: string };

export type CaptionPassResult = { filled: number; failed: CaptionFailure[] };

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
  /** How far a bulk caption pass has got, or null when none is running. */
  const [captionProgress, setCaptionProgress] = useState<{ done: number; total: number } | null>(null);
  /**
   * Clips whose AI caption failed, by clip key, with the reason. This is what
   * stops a failure being invisible: the card is marked, the run offers a retry,
   * and Auto Assign refuses to schedule them behind a green toast.
   */
  const [captionFailures, setCaptionFailures] = useState<Record<string, string>>({});
  const remindedRef = useRef(new Set<string>());
  /**
   * Which two-week window the schedule grid shows, in days after today
   * (0 = the current period, 14 = the next one, …). Nothing is fetched when it
   * moves — `slots` below is derived from it.
   */
  const [slotOffsetDays, setSlotOffsetDays] = useState(DEFAULT_SLOT_OFFSET_DAYS);

  /**
   * The schedule grid for the window on screen. Paging is arithmetic, not a
   * request: `generateSlots` needs only the configured timezone and the offset,
   * and it is the same function the server used to run for this.
   */
  const timezone = overview?.timezone ?? "UTC";
  const slots = useMemo(
    () => generateSlots({ timeZone: timezone, days: SLOT_WINDOW_DAYS, startDayOffset: slotOffsetDays }),
    [timezone, slotOffsetDays]
  );

  const activeYoutubeAccountId = activeAccountIds.youtube;

  // The account the poll should read, without `refresh` changing identity every
  // time it moves — that identity is what the page's 60s timer is keyed on, and
  // rebuilding it restarted the timer and refetched everything again.
  const youtubeAccountRef = useRef(activeYoutubeAccountId);
  useEffect(() => {
    youtubeAccountRef.current = activeYoutubeAccountId;
  }, [activeYoutubeAccountId]);

  /**
   * Whether publishing is on, which timezone the schedule is kept in, and the
   * YouTube quota meter. NOT the slot grid: `generateSlots` is pure arithmetic
   * over the timezone and the offset, so the grid is built here instead — which
   * is what makes paging the calendar a synchronous state change rather than a
   * request that has to queue behind everything else the page is loading.
   */
  const refreshOverview = useCallback(async () => {
    const res = await fetch("/api/publish/overview", { cache: "no-store" });
    if (res.ok) setOverview((await res.json()) as Overview);
  }, []);

  /**
   * Who each platform posts as. Only changes when an account is added, removed
   * or reconnected, so it is read on mount and after those actions rather than
   * on every tick — each account's view costs a profile lookup at its platform.
   */
  const refreshAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/publish/accounts", { cache: "no-store" });
      if (res.ok) setAccounts(((await res.json()) as { accounts?: SocialAccountView[] }).accounts ?? []);
    } catch {
      // Offline — the accounts already on screen stay.
    }
  }, []);

  /**
   * The real YouTube schedule for the account the tab is showing. `force`
   * bypasses the server-side cache right after a publish so the new video
   * appears at once.
   */
  const refreshChannel = useCallback(async (options?: { force?: boolean; accountId?: string }) => {
    const params = new URLSearchParams({ account: options?.accountId ?? youtubeAccountRef.current });
    if (options?.force) params.set("refresh", "1");
    try {
      const res = await fetch(`/api/publish/youtube-channel?${params.toString()}`, { cache: "no-store" });
      if (res.ok) setChannel((await res.json()) as ChannelSchedule);
    } catch {
      // Offline, or the channel read timed out — the last known schedule stays.
    }
  }, []);

  /**
   * Everything the 60-second tick watches: the clip library, the queue, the
   * quota meter and the channel schedule. A failure keeps the last good data
   * and the next tick retries.
   *
   * The screen is NOT gated on the channel read. That one leaves the machine —
   * an OAuth refresh plus three YouTube Data API calls — and awaiting it held
   * the whole page on a spinner behind a browser that only opens six sockets
   * per origin, so the local reads that had already finished stayed invisible.
   * It fills the channel in behind the rendered page instead.
   */
  const refresh = useCallback(
    async (options?: { channelRefresh?: boolean }) => {
      void refreshChannel({ force: options?.channelRefresh });
      try {
        await Promise.all([
          fetch("/api/clips", { cache: "no-store" }).then(async (res) => {
            if (res.ok) setJobs(((await res.json()) as { jobs: ClipJob[] }).jobs);
          }),
          fetch("/api/publish", { cache: "no-store" }).then(async (res) => {
            if (res.ok) setQueueItems(((await res.json()) as { items?: QueueItem[] }).items ?? []);
          }),
          refreshOverview()
        ]);
      } catch {
        // Offline or malformed payload — retry on the next tick.
      } finally {
        setLoaded(true);
      }
    },
    [refreshChannel, refreshOverview]
  );

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

  // The job list carries no transcripts — only the tab actually on screen
  // needs one, so it is fetched per active job rather than for all fifty.
  // Kept with the id they were loaded for, so switching tabs can never read the
  // previous job's transcript over the new job's clips.
  const [loadedCaptions, setLoadedCaptions] = useState<{ jobId: string; captions: CaptionSegment[] } | null>(null);
  const captionsJobId = activeJob?.id ?? null;
  useEffect(() => {
    if (!captionsJobId) return;
    let cancelled = false;
    void loadJobCaptions(captionsJobId).then((captions) => {
      if (!cancelled) setLoadedCaptions({ jobId: captionsJobId, captions });
    });
    return () => {
      cancelled = true;
    };
  }, [captionsJobId]);
  const activeCaptions =
    loadedCaptions && loadedCaptions.jobId === captionsJobId ? loadedCaptions.captions : NO_CAPTIONS;

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
        : leadingSilenceSec(windowSegments(activeCaptions, clip.start, clip.end));
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
  }, [activeCaptions, activeJob, clipProjects]);

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
      slots,
      isSlotOccupied: (slotUtc) => Boolean(youtubeItems?.has(slotUtc)),
      timeZone: timezone
    });
  }, [channelVideos, itemsByPlatformSlot, slots, timezone]);

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
  const fetchTailoredCaption = useCallback(
    async (clip: ReadyClip, platform: PlatformId, title: string): Promise<TailoredCaption> => {
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
        if (!response.ok) return { ok: false, error: await readError(response) };
        const { copy } = (await response.json()) as {
          copy: { caption: string; hashtags: string[]; bestTime?: string; note?: string };
        };
        const caption = copy.hashtags.length ? `${copy.caption}\n\n${copy.hashtags.join(" ")}` : copy.caption;
        return { ok: true, caption, bestTime: copy.bestTime, note: copy.note };
      } catch {
        return { ok: false, error: "Couldn't tailor the caption — try again." };
      }
    },
    []
  );

  const tailorCaption = useCallback(
    async (
      clip: ReadyClip,
      platform: PlatformId,
      title: string
    ): Promise<{ caption: string; bestTime?: string; note?: string } | null> => {
      setBusy(`tailor:${clip.key}`);
      try {
        const result = await fetchTailoredCaption(clip, platform, title);
        if (!result.ok) {
          toast.error(result.error);
          setCaptionFailures((current) => ({ ...current, [clip.key]: result.error }));
          return null;
        }
        setCaptionFailures((current) => {
          if (!(clip.key in current)) return current;
          const { [clip.key]: _cleared, ...rest } = current;
          return rest;
        });
        return result;
      } finally {
        setBusy(null);
      }
    },
    [fetchTailoredCaption]
  );

  /**
   * Writes a caption for every clip handed in, one after another, reporting
   * progress as it goes. A clip whose copy fails is named and skipped — one bad
   * call must not cost the eleven captions behind it — and each caption is
   * handed back the moment it lands, so the run can be watched filling in.
   *
   * The failures come back as clips, not a count: the caller marks those cards,
   * offers a retry, and keeps them out of anything that would schedule them.
   */
  const tailorCaptionsForAll = useCallback(
    async (
      targets: Array<{ clip: ReadyClip; platform: PlatformId; title: string }>,
      onCaption: (clip: ReadyClip, caption: string) => void
    ): Promise<CaptionPassResult> => {
      if (targets.length === 0) return { filled: 0, failed: [] };
      setBusy("captions-all");
      setCaptionProgress({ done: 0, total: targets.length });
      let filled = 0;
      const failed: CaptionFailure[] = [];
      try {
        for (const [index, target] of targets.entries()) {
          const result = await fetchTailoredCaption(target.clip, target.platform, target.title);
          if (!result.ok) {
            failed.push({ clip: target.clip, error: result.error });
          } else {
            filled += 1;
            onCaption(target.clip, result.caption);
          }
          setCaptionProgress({ done: index + 1, total: targets.length });
        }
        setCaptionFailures((current) => {
          const next = { ...current };
          for (const target of targets) delete next[target.clip.key];
          for (const failure of failed) next[failure.clip.key] = failure.error;
          return next;
        });
        const names = nameClips(failed.map((failure) => failure.clip.headline));
        if (failed.length === 0) {
          toast.success(`Wrote ${filled} caption${filled === 1 ? "" : "s"}.`);
        } else if (filled > 0) {
          toast.warning(
            `Wrote ${filled} of ${targets.length} captions. No caption for ${names} — ${failed[0].error}`
          );
        } else {
          toast.error(`Couldn't write a caption for ${names} — ${failed[0].error}`);
        }
        return { filled, failed };
      } finally {
        setCaptionProgress(null);
        setBusy(null);
      }
    },
    [fetchTailoredCaption]
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
        // One post per targeted platform, each on that platform's own active
        // account. Sequential: the queue store isn't safe under concurrent
        // writes. A platform that fails never blocks the rest.
        const platforms = targetPlatforms(draft.platform);
        let scheduled = 0;
        let firstError: string | null = null;
        for (const platform of platforms) {
          const response = await fetch("/api/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: clip.jobId,
              file,
              publishAt: draft.slotUtc,
              title: draft.title.trim() || undefined,
              caption: draft.caption.trim() || undefined,
              platforms: [platform],
              // "public" is what makes YouTube honor publishAt: the video is
              // uploaded private and YouTube flips it live at the slot time.
              visibility: "public",
              // The post lands on the account the platform's tab is showing.
              accountId: activeAccountIds[platform]
            })
          });
          if (!response.ok) {
            firstError ??= await readError(response);
            continue;
          }
          scheduled += 1;
          // YouTube's outcome always gets the full treatment (the upload
          // confirmation dialog, the reconnect prompt); the other platforms
          // fold into the summary below when several were targeted.
          if (platforms.length === 1 || platform === "youtube") {
            await announceScheduleOutcome(response, platform);
          }
        }
        if (scheduled === 0) {
          toast.error(firstError ?? "Couldn't schedule this clip.");
          return false;
        }
        if (platforms.length > 1) {
          if (scheduled === platforms.length) {
            toast.success(`Scheduled on all ${scheduled} platforms.`);
          } else {
            toast.warning(
              `Scheduled on ${scheduled} of ${platforms.length} platforms${firstError ? ` — ${firstError}` : "."}`
            );
          }
        }
        await refresh({ channelRefresh: platforms.includes("youtube") });
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
   *
   * `heldBack` are clips the caller deliberately did not schedule (their AI
   * caption failed). They are named in the summary and the summary stops being
   * green — a success toast over a partial failure is how a clip went out with
   * fallback copy and nobody knew.
   */
  const autoAssign = useCallback(
    async (assignments: Array<{ clip: ReadyClip; draft: ClipDraft }>, heldBack: ReadyClip[] = []) => {
      if (assignments.length === 0) return;
      setBusy("auto-assign");
      // Counted in posts, not clips: a clip aimed at "All platforms" is four.
      const total = assignments.reduce((sum, { draft }) => sum + targetPlatforms(draft.platform).length, 0);
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
          for (const platform of targetPlatforms(draft.platform)) {
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
                  platforms: [platform],
                  visibility: "public",
                  accountId: activeAccountIds[platform]
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
        }
        const held = heldBack.length
          ? ` ${heldBack.length} clip${heldBack.length === 1 ? "" : "s"} left unscheduled — no AI caption for ${nameClips(
              heldBack.map((clip) => clip.headline)
            )}.`
          : "";
        if (scheduled === total && !held) {
          toast.success(`Auto-assigned ${scheduled} post${scheduled === 1 ? "" : "s"} to the next open slots.`);
        } else if (scheduled === total) {
          toast.warning(`Auto-assigned ${scheduled} post${scheduled === 1 ? "" : "s"}.${held}`);
        } else if (scheduled > 0) {
          toast.warning(`Auto-assigned ${scheduled} of ${total} posts${firstError ? ` — ${firstError}` : "."}${held}`);
        } else {
          toast.error(`${firstError ?? "Auto assign failed."}${held}`);
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
        await Promise.all([refreshAccounts(), refresh()]);
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh, refreshAccounts, setActiveAccount]
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
        await Promise.all([refreshAccounts(), refresh()]);
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh, refreshAccounts, setActiveAccount]
  );

  return {
    loaded,
    overview,
    slots,
    slotOffsetDays,
    setSlotOffsetDays,
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
    activeCaptions,
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
    tailorCaptionsForAll,
    captionProgress,
    /** Clip key → why its AI caption failed, for the cards and the retry. */
    captionFailures,
    schedule,
    uploadToSlot,
    autoAssign,
    publishNow,
    remove,
    refresh,
    refreshOverview,
    refreshAccounts,
    refreshChannel
  };
}
