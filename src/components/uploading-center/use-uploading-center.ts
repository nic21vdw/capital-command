"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, type ExternalToast } from "sonner";
import {
  clearBookingSummary,
  loadBookingSummary,
  saveBookingSummary,
  type BookingSummary
} from "@/components/uploading-center/booking-summary-store";
import { loadWorkflowJson, workflowLoadMessage } from "@/lib/marketing/workflow-resource";
import { nameClips } from "@/components/uploading-center/bulk";
import { describeRearmResults, type RearmPlatformResult } from "@/components/uploading-center/failures";
import {
  NO_AI_CAPTION_SUMMARY_NOTE,
  bookedResult,
  isManualLeg,
  refusedResult,
  summarizeAutoAssign,
  summarizeSchedule,
  type PlatformResult,
  type RunOutcome
} from "@/components/uploading-center/schedule-summary";
import { windowSegments } from "@/lib/clipping/captions";
import { loadJobCaptions } from "@/lib/clipping/captions-client";
import { leadingSilenceSec } from "@/lib/clipping/editor";
import { hasEditsBeyondAutoRender } from "@/lib/clipping/export-signature";
import { indexProjectsBySource, newestProjectFor, type ClipProjectIndex } from "@/lib/clipping/project-index";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { CaptionSegment, ClipProject } from "@/types/domain";
import { placeChannelVideos, type ChannelPlacement } from "@/lib/publisher/channelPlacement";
import { ACCOUNTS_SETTINGS_HREF, describeFailure, plainError } from "@/lib/publisher/failure";
import { describeRunOutcome, formatGoLive, manualReminderCopy, type OutcomeLine, type RunOutcomeLike } from "@/lib/publisher/outcomeCopy";
import {
  FACEBOOK_SCHEDULED_POSTS_URL,
  publishedRemovalNote,
  removalImpact,
  removalUndoRequest
} from "@/lib/publisher/boardActions";
import type { ChannelSchedule, ChannelVideo } from "@/lib/publisher/channelVideos";
import { captionRequestFields } from "@/lib/publisher/captionTags";
import { REARM_MAX_SLOT_AGE_HOURS } from "@/lib/publisher/slotAge";
import { indexQueueByClip } from "@/lib/publisher/clipQueueIndex";
import {
  mirroredNote,
  platformTargetHint,
  type PublishMirrorOverview,
  type PublisherAutomationOverview
} from "@/lib/publisher/publishOverview";
import { generateSlots } from "@/lib/publisher/slots";
import { remoteUrlFor } from "@/lib/publisher/remoteUrl";
import type { YoutubeQuota } from "@/lib/publisher/quota";
import { DEFAULT_SLOT_OFFSET_DAYS, SLOT_WINDOW_DAYS } from "@/lib/publisher/slotWindow";
import { ALL_PLATFORMS, type PlatformId, type QueueItem, type TiktokPostOptions } from "@/lib/publisher/types";

export { DEFAULT_SLOT_OFFSET_DAYS, SLOT_WINDOW_DAYS };

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
  slotTimes?: string[];
  weekendSlotTimes?: string[];
  /** Most short-form posts the server will book on one local day (PUBLISH_SHORTS_PER_DAY). */
  shortsPerDay?: number;
  /** Whether the runner copies YouTube's schedule onto Instagram and Facebook. */
  mirror?: PublishMirrorOverview;
  /** Whether the publisher is paused, and whether its runner is installed and running. */
  automation?: PublisherAutomationOverview;
  /**
   * Whether a model can write captions (never says which, or with what key).
   * Absent on an older server, which is read as "yes": that is the default.
   */
  aiCopyAvailable?: boolean;
  quota: YoutubeQuota;
};

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
function computeNeedsRerender(clip: ClipCandidate, jobId: string, projects: ClipProjectIndex): boolean {
  if (!clip.file) return false;
  const project = newestProjectFor(projects, jobId, clip.file);
  if (!project) return false;
  if (clip.editedFile) {
    // A render exists — stale only if the project changed since it was made.
    // Legacy renders carry no signature; leave those alone to avoid false alarms.
    if (!clip.editedSignature) return false;
    // The project's own signature, stamped server-side on every write. It is
    // read rather than recomputed because the signature hashes the captions and
    // the payload no longer carries them — and a project too old to have been
    // stamped is left alone for the same reason a legacy render is.
    const signature = project.renderSignature;
    if (!signature) return false;
    return signature !== clip.editedSignature;
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

/** "Retry connection failures" leaves failures whose slot is older than this for one-by-one retry. */
export { REARM_MAX_SLOT_AGE_HOURS };

export type PlatformTarget = PlatformId | typeof ALL_PLATFORMS_TARGET;

export function targetPlatforms(target: PlatformTarget): PlatformId[] {
  return target === ALL_PLATFORMS_TARGET ? [...ALL_PLATFORMS] : [target];
}

/**
 * The requests a target actually makes. Instagram carries Facebook with it —
 * one queue item, both platforms (see `metaPairing.ts`) — so asking for
 * Facebook separately would only be refused as a duplicate of the post that
 * already covers it.
 */
export function schedulePlatforms(target: PlatformTarget): PlatformId[] {
  const platforms = targetPlatforms(target);
  return platforms.includes("instagram") ? platforms.filter((platform) => platform !== "facebook") : platforms;
}

export type ClipDraft = {
  title: string;
  caption: string;
  platform: PlatformTarget;
  slotUtc: string;
  /**
   * The creator's TikTok consent, present only once they have opened the
   * panel and chosen to post straight to the profile. Absent means the clip
   * goes to the TikTok inbox, which is what every clip did before the panel.
   */
  tiktok?: TiktokPostOptions;
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

/**
 * The picker's wording, which says what a target really posts to: choosing
 * Instagram posts to the Facebook Page too (`metaPairing.ts`).
 */
export const PLATFORM_TARGET_LABELS: Record<PlatformTarget, string> = {
  all: "All platforms",
  ...PLATFORM_LABELS,
  instagram: "Instagram + Facebook"
};

/**
 * The picker's wording once the mirror is known: with PUBLISH_MIRROR on, a
 * YouTube booking also reaches Instagram and Facebook (the runner copies it
 * over), so the picker says so rather than letting those posts surprise him.
 */
export function platformTargetLabels(mirror?: PublishMirrorOverview): Record<PlatformTarget, string> {
  const note = mirroredNote(mirror, PLATFORM_LABELS);
  return mirror && note ? { ...PLATFORM_TARGET_LABELS, [mirror.lead]: note } : PLATFORM_TARGET_LABELS;
}

/** What each picker option books, for the line under the draft's platform select. */
export function platformTargetHints(mirror?: PublishMirrorOverview): Record<PlatformTarget, string> {
  const hints = {} as Record<PlatformTarget, string>;
  for (const target of Object.keys(PLATFORM_TARGET_LABELS) as PlatformTarget[]) {
    hints[target] = platformTargetHint(target, mirror, PLATFORM_LABELS);
  }
  return hints;
}

/**
 * The platform whose copy an "all platforms" caption is written for. One
 * caption goes out to every platform (the queue stores one caption per post and
 * the draft holds one), so it is written for the MOST RESTRICTIVE of them:
 * TikTok's short, punchy copy with five hashtags fits a YouTube description, an
 * Instagram caption and a Facebook post. It used to be written for YouTube,
 * which is the one platform where long copy is rewarded, and then posted
 * everywhere.
 */
export function copyPlatformFor(target: PlatformTarget): PlatformId {
  return target === ALL_PLATFORMS_TARGET ? "tiktok" : target;
}

/** What a toast calls the audience of an AI caption, so "all" is not a silent fib. */
export function copyTargetLabel(target: PlatformTarget): string {
  return target === ALL_PLATFORMS_TARGET
    ? "all platforms (short copy written to fit all of them)"
    : PLATFORM_TARGET_LABELS[target];
}

// Keep in sync with the Clip Generator's headline: the creator/auto title on
// the backend clip wins, then the hook quote, then a quote from the rationale.
function clipHeadline(clip: ClipCandidate, index: number) {
  if (clip.title) return clip.title;
  if (clip.hookQuote) return clip.hookQuote;
  const quoted = clip.rationale.match(/"([^"]{8,90})"/);
  return quoted?.[1] ?? `Clip ${index + 1}`;
}

/** Stable empty list, so a clip with no posts doesn't rebuild its card. */
const NO_ITEMS: QueueItem[] = [];

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

// The link builder lives in lib/publisher so the calendars can use it too.
export { remoteUrlFor };

/**
 * Scrolls to a post on the board and opens its inline title editor - the same
 * one its pencil opens. The post can be on more than one platform tab (one
 * element per tab), so the one actually on screen is the one used.
 */
export function focusRenameOnBoard(itemId: string): boolean {
  if (typeof document === "undefined") return false;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(`[id="queue-item-${itemId}"]`));
  const card = cards.find((candidate) => candidate.offsetParent !== null) ?? cards[0];
  if (!card) return false;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.querySelector<HTMLButtonElement>('button[aria-label="Rename video"]')?.click();
  return true;
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
/**
 * An error toast with a stable id. The same failure repeated (three clips
 * refused for the same reason, a retry that fails the same way) UPDATES the
 * toast already on screen instead of stacking a copy of it, which is how three
 * identical red toasts ended up overlapping.
 */
export function errorToast(message: string, options?: ExternalToast) {
  // A not-connected adapter error names environment variables; say what to do
  // instead, and offer Settings (beside any action the caller already set).
  const plain = plainError(message);
  const settings = { label: "Open Settings", onClick: () => window.location.assign(ACCOUNTS_SETTINGS_HREF) };
  const link = plain.notConnected ? (options?.action ? { cancel: settings } : { action: settings }) : {};
  return toast.error(plain.text, { id: `error:${plain.text}`, ...link, ...options });
}

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
  | { ok: true; caption: string; bestTime?: string; note?: string; source: "ai" | "fallback" }
  | { ok: false; error: string };

/** What the screen says when no AI key is set and the clip title stood in. */
export const NO_AI_CAPTION_NOTICE = "No AI key set - used the clip title as the caption. Edit it before booking.";
export const NO_AI_CAPTION_NOTICE_PLURAL =
  "No AI key set - used the clip titles as the captions. Edit them before booking.";

/** One clip a bulk caption pass could not write copy for, and why. */
export type CaptionFailure = { clip: ReadyClip; error: string };

/** `usedTitle` counts captions that are just the clip title because no AI key answered. */
export type CaptionPassResult = { filled: number; failed: CaptionFailure[]; usedTitle?: number };

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
  const [channelSnapshot, setChannelSnapshot] = useState<{ accountId: string; schedule: ChannelSchedule } | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountView[]>([]);
  /**
   * Which account each platform's tab (and calendar) is showing. Defaults to
   * every platform's primary account — the pre-multi-account behavior — so
   * everything already scheduled or uploaded stays right where it was.
   */
  const [activeAccountIds, setActiveAccountIds] = useState<Record<PlatformId, string>>(DEFAULT_ACTIVE_ACCOUNTS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsRefreshing, setAccountsRefreshing] = useState(false);
  const accountsInFlightRef = useRef(false);
  const [channelFailure, setChannelFailure] = useState<{ accountId: string; message: string } | null>(null);
  const [channelRefreshing, setChannelRefreshing] = useState(false);
  const channelRequestRef = useRef(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /** Key of the action in flight ("schedule:<clipKey>", "publish:<id>", …). */
  const [busy, setBusy] = useState<string | null>(null);
  /** Set right after a YouTube upload succeeds; drives the confirmation dialog. */
  const [uploadSuccess, setUploadSuccess] = useState<UploadSuccess | null>(null);
  /** How far a bulk caption pass has got, or null when none is running. */
  const [captionProgress, setCaptionProgress] = useState<{ done: number; total: number } | null>(null);
  /**
   * What the last bulk booking did to each run, set this session. `null` is a dismissal and
   * beats whatever the browser remembers; a run with no entry falls back to the stored line
   * (booking-summary-store), which is how the summary survives a reload.
   */
  const [bookingSummaries, setBookingSummaries] = useState<Record<string, BookingSummary | null>>({});
  const setBookingSummaryFor = useCallback((jobId: string, summary: BookingSummary | null) => {
    setBookingSummaries((current) => ({ ...current, [jobId]: summary }));
    if (summary) saveBookingSummary(jobId, summary);
    else clearBookingSummary(jobId);
  }, []);
  /**
   * Clips whose AI caption failed, by clip key, with the reason. This is what
   * stops a failure being invisible: the card is marked, the run offers a retry,
   * and Auto Assign refuses to schedule them behind a green toast.
   */
  const [captionFailures, setCaptionFailures] = useState<Record<string, string>>({});
  // What the last caption request really returned: "fallback" means no model
  // answered and the clip's title stood in, whatever the config promised.
  const [aiCopyFellBack, setAiCopyFellBack] = useState(false);
  const remindedRef = useRef(new Set<string>());
  const refreshInFlightRef = useRef(false);
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
  // The times the SERVER books on, not this file's defaults: the grid is
  // configurable, and a picker drawing a different day than the booking sheet
  // is a slot he can see and nothing can fill.
  const slotTimes = overview?.slotTimes;
  const weekendSlotTimes = overview?.weekendSlotTimes;
  const slots = useMemo(
    () =>
      generateSlots({
        timeZone: timezone,
        days: SLOT_WINDOW_DAYS,
        startDayOffset: slotOffsetDays,
        ...(slotTimes ? { times: slotTimes } : {}),
        ...(weekendSlotTimes ? { weekendTimes: weekendSlotTimes } : {})
      }),
    [timezone, slotOffsetDays, slotTimes, weekendSlotTimes]
  );

  const activeYoutubeAccountId = activeAccountIds.youtube;
  const channel = channelSnapshot?.accountId === activeYoutubeAccountId ? channelSnapshot.schedule : null;
  const channelError = channelFailure?.accountId === activeYoutubeAccountId ? channelFailure.message : null;

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
    const next = await loadWorkflowJson<Overview>("/api/publish/overview");
    if (typeof next.enabled !== "boolean" || typeof next.timezone !== "string" || !next.quota) {
      throw new Error("The publishing settings could not be loaded.");
    }
    setOverview(next);
  }, []);

  /**
   * Who each platform posts as. Only changes when an account is added, removed
   * or reconnected, so it is read on mount and after those actions rather than
   * on every tick — each account's view costs a profile lookup at its platform.
   */
  const refreshAccounts = useCallback(async () => {
    if (accountsInFlightRef.current) return;
    accountsInFlightRef.current = true;
    setAccountsRefreshing(true);
    try {
      const next = await loadWorkflowJson<{ accounts: SocialAccountView[] }>("/api/publish/accounts", "accounts");
      setAccounts(next.accounts);
      setAccountsLoaded(true);
      setAccountsError(null);
    } catch (error) {
      setAccountsError(workflowLoadMessage(error));
    } finally {
      accountsInFlightRef.current = false;
      setAccountsRefreshing(false);
    }
  }, []);

  /**
   * The real YouTube schedule for the account the tab is showing. `force`
   * bypasses the server-side cache right after a publish so the new video
   * appears at once.
   */
  const refreshChannel = useCallback(async (options?: { force?: boolean; accountId?: string }) => {
    const accountId = options?.accountId ?? youtubeAccountRef.current;
    const request = ++channelRequestRef.current;
    setChannelRefreshing(true);
    const params = new URLSearchParams({ account: accountId });
    if (options?.force) params.set("refresh", "1");
    try {
      const next = await loadWorkflowJson<ChannelSchedule>(`/api/publish/youtube-channel?${params.toString()}`, "videos");
      if (request !== channelRequestRef.current) return;
      setChannelSnapshot({ accountId, schedule: next });
      setChannelFailure(null);
    } catch (error) {
      if (request === channelRequestRef.current) setChannelFailure({ accountId, message: workflowLoadMessage(error) });
    } finally {
      if (request === channelRequestRef.current) setChannelRefreshing(false);
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
      if (refreshInFlightRef.current) {
        if (options?.channelRefresh) void refreshChannel({ force: true });
        return;
      }
      refreshInFlightRef.current = true;
      setRefreshing(true);
      void refreshChannel({ force: options?.channelRefresh });
      try {
        const results = await Promise.allSettled([
          loadWorkflowJson<{ jobs: ClipJob[] }>("/api/clips", "jobs").then((next) => {
            setJobs(next.jobs);
          }),
          loadWorkflowJson<{ items: QueueItem[] }>("/api/publish?board=1", "items").then((next) => {
            setQueueItems(next.items);
          }),
          refreshOverview()
        ]);
        const failures = results.flatMap((result) => result.status === "rejected" ? [workflowLoadMessage(result.reason)] : []);
        if (failures.length > 0) {
          setLoadError([...new Set(failures)].join(" "));
        } else {
          setLoaded(true);
          setLoadError(null);
        }
      } finally {
        refreshInFlightRef.current = false;
        setRefreshing(false);
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
  // Only the run on screen shows its summary: another run's line would describe clips that are not here.
  const bookingSummary = useMemo(() => {
    if (!activeJob) return null;
    const session = bookingSummaries[activeJob.id];
    return session !== undefined ? session : loadBookingSummary(activeJob.id);
  }, [activeJob, bookingSummaries]);

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

  /**
   * Job + source file → newest project, built once for the whole store rather
   * than re-derived per clip card (see `project-index.ts`).
   */
  const projectIndex = useMemo(() => indexProjectsBySource(clipProjects), [clipProjects]);

  const readyClips = useMemo<ReadyClip[]>(() => {
    if (!activeJob) return [];
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
      // where the user set its start. A ready render that already cut the dead
      // air out of the file (`hookTrimSec`) must not have it skipped twice.
      const alreadyTrimmed = file === clip.downloadFile && clip.hookTrimSec !== undefined;
      const startSec =
        clip.editedFile || alreadyTrimmed
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
          needsRerender: computeNeedsRerender(clip, activeJob.id, projectIndex),
          masterFile: clip.file
        }
      ];
    });
  }, [activeCaptions, activeJob, projectIndex]);

  /**
   * Clip key → its posts on the queue, indexed once. Every card, the run
   * summary and the auto-assign plan read this, so answering each of them with
   * a fresh scan of the whole queue was the page's per-render cost.
   */
  const itemsByClipKey = useMemo(() => indexQueueByClip(queueItems, readyClips), [queueItems, readyClips]);
  const itemsForClip = useCallback((clip: ReadyClip) => itemsByClipKey.get(clip.key) ?? NO_ITEMS, [itemsByClipKey]);

  /**
   * Poster-frame URL for a queue item. A clip job already has a rendered
   * poster, so that is preferred and costs nothing. Everything else — a
   * long-form edit, a topic segment, an adopted video, anything the CLI queued
   * — falls back to the queue's own thumbnail route, which pulls a frame from
   * the file the post will publish. Every scheduled video shows a picture now,
   * so an empty box means the file is missing rather than "this post came in
   * through a different door".
   */
  const thumbnailByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of queueItems) {
      const job = item.jobId ? jobs.find((candidate) => candidate.id === item.jobId) : undefined;
      const normalized = (item.sourceClipPath ?? item.clipPath).replace(/\\/g, "/");
      const clip = job?.clips.find((candidate) =>
        clipFiles(candidate).some((file) => normalized.endsWith(`/${file}`))
      );
      // The clips thumbnail endpoint only serves files the job produced
      // (clip.file); downloadFile renders aren't in that list.
      if (job && clip?.posterFile) {
        map.set(item.id, `/api/clips/${job.id}/files/${encodeURIComponent(clip.posterFile)}`);
      } else if (job && clip?.file) {
        map.set(item.id, `/api/clips/${job.id}/thumbnail/${encodeURIComponent(clip.file)}`);
      } else {
        map.set(item.id, `/api/publish/${item.id}/thumbnail`);
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
        errorToast("Could not save the clip title.");
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
          toast.warning(`Title saved here, but YouTube didn't take it: ${plainError(youtubeError ?? "unknown error").text}`);
        } else {
          // Not on YouTube yet: the new title is simply what it uploads with.
          toast.success("Title saved. It uploads with this title.");
        }
      } catch (error) {
        errorToast(error instanceof Error ? error.message : "Could not rename the post.");
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
  const announceScheduleOutcome = useCallback(
    async (
      response: Response,
      platform: PlatformId,
      /**
       * Part of a multi-platform booking: the one summary toast carries the
       * words, so only what a toast cannot say is kept here - the YouTube
       * confirmation dialog and the reconnect prompt.
       */
      options?: { summary?: boolean }
    ): Promise<{ item?: QueueItem; result: PlatformResult }> => {
      const { item, report } = (await response.json()) as {
        item?: QueueItem;
        report?: { outcomes: RunOutcome[] };
      };
      const outcome = report?.outcomes.find((entry) => entry.platform === platform);
      const result = bookedResult(platform, item, outcome);
      const postId = platform === "youtube" ? item?.platforms.youtube?.postId : undefined;
      const videoUrl = remoteUrlFor(platform, postId);
      const quiet = options?.summary === true;
      if ((outcome?.outcome === "scheduled" || outcome?.outcome === "published") && item && videoUrl) {
        // The confirmation dialog (video link + YouTube Studio button)
        // replaces the plain toast for a completed YouTube upload.
        setUploadSuccess({ title: item.title, videoUrl, status: outcome.outcome, publishAt: item.publishAt, postId });
      } else if (
        platform === "youtube" &&
        outcome?.outcome === "failed" &&
        outcome.detail.includes("YouTube connection expired")
      ) {
        const accountId = item?.accountId ?? primaryAccountIdFor("youtube");
        errorToast("Your YouTube connection expired. Reconnect once and CoLateral Marketing will resume this upload automatically.", {
          duration: Infinity,
          action: {
            label: "Reconnect YouTube",
            onClick: () => {
              window.location.href = `/api/auth/google?account=${encodeURIComponent(accountId)}`;
            }
          }
        });
      } else if (quiet) {
        // Said in the summary.
      } else if (outcome?.outcome === "scheduled") {
        toast.success("Uploaded to YouTube — it now shows as Scheduled on your channel.");
      } else if (outcome?.outcome === "published") {
        toast.success(`Published to ${PLATFORM_LABELS[platform]}.`);
      } else if (outcome?.outcome === "retrying") {
        toast.warning(`Upload interrupted — CoLateral Marketing will retry automatically. ${outcome.detail || ""}`.trim());
      } else if (outcome?.outcome === "failed") {
        errorToast(
          `Upload failed: ${describeFailure({ status: "failed", attempts: 0, error: outcome.detail }, platform).headline}`
        );
      } else if (result.manual) {
        // Booked, but only as a reminder: nothing posts by itself. Amber, not green.
        toast.warning(manualReminderCopy(platform));
      } else {
        toast.success(`Scheduled for ${PLATFORM_LABELS[platform]}.`);
      }
      return { item, result };
    },
    []
  );

  /**
   * The clip's most recently edited Clip Editor project, used to bake its trim
   * into a render right before scheduling. Matched on the clip's master file,
   * the key projects are saved against (see computeNeedsRerender).
   */
  const projectForClip = useCallback(
    (clip: ReadyClip): ClipProject | null => newestProjectFor(projectIndex, clip.jobId, clip.masterFile),
    [projectIndex]
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
        const { copy, source } = (await response.json()) as {
          copy: { caption: string; hashtags: string[]; bestTime?: string; note?: string };
          source?: "ai" | "fallback";
        };
        const caption = copy.hashtags.length ? `${copy.caption}\n\n${copy.hashtags.join(" ")}` : copy.caption;
        setAiCopyFellBack(source === "fallback");
        return { ok: true, caption, bestTime: copy.bestTime, note: copy.note, source: source ?? "ai" };
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
    ): Promise<{ caption: string; bestTime?: string; note?: string; source: "ai" | "fallback" } | null> => {
      setBusy(`tailor:${clip.key}`);
      try {
        const result = await fetchTailoredCaption(clip, platform, title);
        if (!result.ok) {
          errorToast(result.error);
          setCaptionFailures((current) => ({ ...current, [clip.key]: result.error }));
          return null;
        }
        setCaptionFailures((current) => {
          if (!(clip.key in current)) return current;
          const rest = { ...current };
          delete rest[clip.key];
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
      onCaption: (clip: ReadyClip, caption: string) => void,
      /**
       * Booking follows this pass straight away (Auto Assign), so the caller says the
       * no-AI-key notice itself, in the tense that is true by then.
       */
      options: { deferFallbackNotice?: boolean } = {}
    ): Promise<CaptionPassResult> => {
      if (targets.length === 0) return { filled: 0, failed: [] };
      setBusy("captions-all");
      setCaptionProgress({ done: 0, total: targets.length });
      let filled = 0;
      let usedTitle = 0;
      const failed: CaptionFailure[] = [];
      try {
        for (const [index, target] of targets.entries()) {
          const result = await fetchTailoredCaption(target.clip, target.platform, target.title);
          if (!result.ok) {
            failed.push({ clip: target.clip, error: result.error });
          } else {
            filled += 1;
            if (result.source === "fallback") usedTitle += 1;
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
        if (failed.length === 0 && usedTitle > 0) {
          // No model answered: the "captions" are the clip titles. Say so.
          if (!options.deferFallbackNotice) toast.warning(NO_AI_CAPTION_NOTICE_PLURAL, { id: "caption-fallback" });
        } else if (failed.length === 0) {
          toast.success(`Wrote ${filled} caption${filled === 1 ? "" : "s"}.`);
        } else if (filled > 0) {
          toast.warning(
            `Wrote ${filled} of ${targets.length} captions. No caption for ${names} — ${failed[0].error}`
          );
        } else {
          errorToast(`Couldn't write a caption for ${names} — ${failed[0].error}`);
        }
        return { filled, failed, usedTitle };
      } finally {
        setCaptionProgress(null);
        setBusy(null);
      }
    },
    [fetchTailoredCaption]
  );

  const schedule = useCallback(
    async (
      clip: ReadyClip,
      draft: ClipDraft,
      options: {
        /** Told the caption written for an empty box, so the card shows what was posted. */
        onCaption?: (caption: string) => void;
      } = {}
    ) => {
      if (!draft.slotUtc) {
        errorToast("Pick a schedule slot first.");
        return false;
      }
      setBusy(`schedule:${clip.key}`);
      try {
        // An empty caption box means "write one when I schedule", which is what
        // its placeholder promises. Without this the post went out with no
        // caption at all when no AI key was set. With no key the words are the
        // clip's title (the same fallback the bulk button uses) and the toast
        // below says so. A failed write is not fatal: enqueue writes one too.
        let caption = draft.caption;
        let usedTitle = false;
        if (!caption.trim()) {
          const written = await fetchTailoredCaption(clip, copyPlatformFor(draft.platform), draft.title);
          if (written.ok && written.caption.trim()) {
            caption = written.caption;
            usedTitle = written.source === "fallback";
            options.onCaption?.(caption);
          }
        }
        // If the trim/edits aren't baked into the current render, render them
        // now and post the fresh cut — so the upload is always the edited clip,
        // no round-trip through the editor required.
        let file = clip.file;
        if (clip.needsRerender) {
          const project = projectForClip(clip);
          if (!project) {
            errorToast("Open this clip in the editor and hit Schedule Short to bake in your edits first.");
            return false;
          }
          const bakeToast = toast.loading("Baking your trim before scheduling…");
          try {
            file = await bakeProject(project);
          } catch (error) {
            errorToast(`Couldn't render the trimmed clip: ${error instanceof Error ? error.message : "render failed"}.`, {
              id: bakeToast
            });
            return false;
          }
          toast.dismiss(bakeToast);
        }
        // One post per targeted platform, each on that platform's own active
        // account. Sequential: the queue store isn't safe under concurrent
        // writes. A platform that fails never blocks the rest.
        const platforms = schedulePlatforms(draft.platform);
        const several = platforms.length > 1;
        const results: PlatformResult[] = [];
        let firstError: string | null = null;
        for (const platform of platforms) {
          let response: Response;
          try {
            response = await fetch("/api/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId: clip.jobId,
                file,
                publishAt: draft.slotUtc,
                title: draft.title.trim() || undefined,
                // The AI caption's hashtag line travels as `hashtags`; left inside the
                // caption, enqueue generated a second set on top of it.
                ...captionRequestFields(caption),
                platforms: [platform],
                // "public" is what makes YouTube honor publishAt: the video is
                // uploaded private and YouTube flips it live at the slot time.
                visibility: "public",
                // The post lands on the account the platform's tab is showing.
                accountId: activeAccountIds[platform],
                // Only TikTok has consent to carry, and only when the creator
                // chose to post straight to the profile.
                ...(platform === "tiktok" && draft.tiktok ? { tiktok: draft.tiktok } : {})
              })
            });
          } catch {
            firstError ??= "Network error while scheduling.";
            results.push(refusedResult(platform, "network error while scheduling"));
            continue;
          }
          if (!response.ok) {
            const error = await readError(response);
            firstError ??= error;
            results.push(refusedResult(platform, error));
            continue;
          }
          // The outcome of each request (the YouTube confirmation dialog, the
          // reconnect prompt) is announced as it lands; with several platforms
          // the words wait for the one summary below.
          const { result } = await announceScheduleOutcome(response, platform, { summary: several });
          results.push(result);
        }
        const booked = results.filter((result) => result.booked);
        if (!several && booked.length === 0) {
          errorToast(firstError ?? "Couldn't schedule this clip.");
          return false;
        }
        if (several) {
          // One toast, a line per platform: "scheduled everywhere" used to hide
          // which platform refused and why.
          const summary = summarizeSchedule(results);
          const noKeyNote = usedTitle && booked.length > 0;
          toast[noKeyNote && summary.level === "success" ? "warning" : summary.level](summary.title, {
            description: [...summary.lines, ...(noKeyNote ? [NO_AI_CAPTION_SUMMARY_NOTE] : [])].join("\n"),
            duration: summary.level === "success" && !noKeyNote ? 8000 : 15000,
            style: { whiteSpace: "pre-line" }
          });
          if (booked.length === 0) return false;
        } else if (usedTitle) {
          // Said beside the booking's own toast, not instead of it: the post is
          // booked, and its caption is only the title.
          toast.warning(NO_AI_CAPTION_SUMMARY_NOTE, { id: "caption-fallback", duration: 15000 });
        }
        await refresh({ channelRefresh: platforms.includes("youtube") });
        return true;
      } finally {
        setBusy(null);
      }
    },
    [activeAccountIds, announceScheduleOutcome, fetchTailoredCaption, projectForClip, refresh]
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
          errorToast(await readError(response));
          return false;
        }
        const { item } = await announceScheduleOutcome(response, draft.platform);
        await refresh({ channelRefresh: draft.platform === "youtube" });
        // The title and caption were written from the file's name, so say what
        // they came out as, and where to change it, before it goes live.
        if (item) {
          toast(`Titled “${item.title}” from the file name.`, {
            description: "Rename it on the board if that isn't what you want to post.",
            duration: 12000,
            action: { label: "Rename", onClick: () => focusRenameOnBoard(item.id) }
          });
        }
        return true;
      } catch {
        errorToast("Network error while uploading the video.");
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
    async (
      assignments: Array<{ clip: ReadyClip; draft: ClipDraft }>,
      heldBack: ReadyClip[] = [],
      /** A sentence to keep in the persisted summary (e.g. NO_AI_CAPTION_SUMMARY_NOTE). */
      note?: string
    ) => {
      if (assignments.length === 0) return;
      setBusy("auto-assign");
      // Counted in requests, not clips: a clip aimed at "All platforms" is
      // three, the Instagram one carrying Facebook with it.
      const total = assignments.reduce((sum, { draft }) => sum + schedulePlatforms(draft.platform).length, 0);
      let scheduled = 0;
      let manual = 0;
      const manualPlatforms: string[] = [];
      // The slot and queue id of every post the queue accepted, for "4 booked for
      // Oct 13-16" and the "View 4 bookings" button that finds them again.
      const bookedSlots: string[] = [];
      const bookedIds: string[] = [];
      let firstError: string | null = null;
      const summaryJobId = assignments[0].clip.jobId;
      setBookingSummaryFor(summaryJobId, null);
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
          for (const platform of schedulePlatforms(draft.platform)) {
            try {
              const response = await fetch("/api/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jobId: clip.jobId,
                  file,
                  publishAt: draft.slotUtc,
                  title: draft.title.trim() || undefined,
                  // The AI caption's hashtag line travels as `hashtags`; left inside the
              // caption, enqueue generated a second set on top of it.
              ...captionRequestFields(draft.caption),
                  platforms: [platform],
                  visibility: "public",
                  accountId: activeAccountIds[platform],
                  ...(platform === "tiktok" && draft.tiktok ? { tiktok: draft.tiktok } : {})
                })
              });
              if (!response.ok) {
                firstError ??= await readError(response);
                continue;
              }
              scheduled += 1;
              // A platform with no connected account is booked as a reminder.
              const booked = (await response.json().catch(() => null)) as { item?: QueueItem } | null;
              bookedSlots.push(draft.slotUtc);
              if (booked?.item?.id) bookedIds.push(booked.item.id);
              if (isManualLeg(booked?.item, platform)) {
                manual += 1;
                manualPlatforms.push(PLATFORM_LABELS[platform]);
              }
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
        const summary = summarizeAutoAssign({
          scheduled,
          manual,
          total,
          manualPlatforms,
          firstError,
          held,
          bookedSlots,
          timeZone: timezone,
          note
        });
        // Said ONCE, in the run's card beside the button that was pressed. It used
        // to be a toast as well, the same words twice within a second, and the
        // card's line is the one that survives a reload and carries "View N
        // bookings". It is a status region, so a screen reader hears it too.
        setBookingSummaryFor(summaryJobId, { ...summary, ...(bookedIds.length > 0 ? { itemIds: bookedIds } : {}) });
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [activeAccountIds, projectForClip, refresh, setBookingSummaryFor, timezone]
  );

  /** Shows each run outcome as the toast its tone calls for. */
  const showOutcomes = useCallback((lines: OutcomeLine[]) => {
    for (const line of lines) {
      if (line.tone === "error") errorToast(line.text);
      else if (line.tone === "warning") toast.warning(line.text);
      else if (line.tone === "info") toast.info(line.text);
      else toast.success(line.text);
    }
  }, []);

  /**
   * Publish now, confirmed on the board first: every platform on the post that
   * has not finished goes out immediately, and a YouTube video held for its slot
   * is made public. The toast says what happened to each, in words.
   */
  const publishNow = useCallback(
    async (item: QueueItem, platforms?: PlatformId[]) => {
      setBusy(`publish:${item.id}`);
      try {
        const response = await fetch(`/api/publish/${item.id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `platforms` leaves out legs whose account is not connected: they stay waiting.
          body: JSON.stringify(platforms ? { mode: "now", platforms } : { mode: "now" })
        });
        if (!response.ok) {
          errorToast(await readError(response));
          return;
        }
        const { report } = (await response.json()) as {
          report: { outcomes: Array<{ platform: string; outcome: string; detail: string }> };
        };
        showOutcomes(report.outcomes.map((outcome) => describeRunOutcome(outcome, { publishAt: item.publishAt, timeZone: timezone })));
        if (report.outcomes.length === 0) toast.info("Nothing left to publish on that post.");
        await refresh({ channelRefresh: true });
      } finally {
        setBusy(null);
      }
    },
    [refresh, showOutcomes, timezone]
  );

  /**
   * Retry one platform of a post. Puts only that platform's leg back in the
   * queue, then runs the post WITHOUT force: a slot that has passed posts now,
   * a slot still ahead waits for it, and the post's other platforms are left
   * exactly as they were (a forced run would publish them all early).
   */
  const retryQueueItem = useCallback(
    async (item: QueueItem, platform: PlatformId) => {
      setBusy(`publish:${item.id}`);
      try {
        const rearm = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry", itemId: item.id, platform })
        }).catch(() => null);
        if (!rearm) {
          errorToast("Network error while retrying that post.");
          return;
        }
        if (!rearm.ok) {
          errorToast(await readError(rearm));
          return;
        }
        const slotPassed = new Date(item.publishAt).getTime() <= Date.now();
        const run = await fetch(`/api/publish/${item.id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "slot" })
        }).catch(() => null);
        const report = run?.ok
          ? ((await run.json().catch(() => null)) as { report?: { outcomes: RunOutcomeLike[] } } | null)?.report
          : undefined;
        const outcomes = report?.outcomes ?? [];
        if (!report) {
          toast.warning(
            `${PLATFORM_LABELS[platform]} is back in the queue, but the run did not start. It is picked up on the next pass.`
          );
        } else if (outcomes.length === 0) {
          toast.success(
            slotPassed
              ? `${PLATFORM_LABELS[platform]} is back in the queue and posts on the next run.`
              : `${PLATFORM_LABELS[platform]} is back in the queue. It posts at its slot, ${formatGoLive(item.publishAt, timezone)} - the post's other platforms were not touched.`
          );
        } else {
          showOutcomes(outcomes.map((outcome) => describeRunOutcome(outcome, { publishAt: item.publishAt, timeZone: timezone })));
        }
        await refresh({ channelRefresh: true });
      } finally {
        setBusy(null);
      }
    },
    [refresh, showOutcomes, timezone]
  );

  /**
   * Books a removed post again - the toast's Undo. It is the ordinary booking
   * route, so the slot and duplicate rules apply to it like to any new post; if
   * the queue refuses, the toast says why and the post stays removed.
   */
  const restoreRemoved = useCallback(
    async (request: Record<string, unknown>, title: string) => {
      setBusy("restore");
      try {
        const response = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request)
        });
        if (!response.ok) {
          errorToast(`Could not put "${title}" back: ${await readError(response)}`);
        } else {
          toast.success(`"${title}" is back on the schedule.`);
        }
        await refresh();
      } catch {
        errorToast(`Could not put "${title}" back: network error.`);
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  /**
   * Removes the whole post (every platform on it). The board has already asked
   * and listed the platforms. The server keeps a YouTube video the channel
   * already holds private instead of leaving it to go live, and reports a
   * Facebook post it cannot cancel; the toast says which happened.
   *
   * Undo is offered only for a post nothing was sent for (see
   * `removalUndoRequest`): once a platform holds a copy, putting the post back
   * would book a second one and leave the first behind, so the toast says what
   * happened to the platform instead.
   */
  const remove = useCallback(
    async (item: QueueItem, options: { anyway?: boolean } = {}) => {
      setBusy(`remove:${item.id}`);
      try {
        const response = await fetch(`/api/publish/${item.id}${options.anyway ? "?anyway=1" : ""}`, { method: "DELETE" });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
          const message = detail?.error ?? "Could not remove that post.";
          if (
            detail?.code === "youtube-hold-failed" ||
            detail?.code === "uploading" ||
            detail?.code === "youtube-may-exist"
          ) {
            errorToast(message, {
              duration: Infinity,
              action: { label: "Remove anyway", onClick: () => void remove(item, { anyway: true }) }
            });
          } else {
            errorToast(message);
          }
        } else {
          const result = (await response.json().catch(() => ({}))) as {
            youtube?: string;
            youtubeVideoId?: string;
            youtubeMayExist?: boolean;
            facebookPostId?: string;
          };
          const studio = result.youtubeVideoId
            ? { label: "Open in Studio", onClick: () => window.open(studioVideoUrl(result.youtubeVideoId!), "_blank", "noopener") }
            : undefined;
          if (result.youtube === "held" || result.youtube === "already-private") {
            toast.success("Removed from the schedule. The YouTube video was kept private - it is not deleted.", {
              description: "To post it later, set a time or make it public in YouTube Studio.",
              action: studio
            });
          } else if (result.youtube === "already-public") {
            toast.warning("Removed from the schedule, but the YouTube video is already public.", {
              description: "Delete or hide it in YouTube Studio if you do not want it up.",
              action: studio
            });
          } else if (result.youtube === "unchecked") {
            toast.warning("Removed from the schedule, but YouTube was not told. The video may still go live at its time.", {
              action: studio
            });
          } else {
            const live = removalImpact(item).published;
            const undoRequest = result.facebookPostId || result.youtubeMayExist ? null : removalUndoRequest(item, { timeZone: timezone });
            toast.success("Removed from the schedule.", {
              ...(live.length > 0 ? { description: publishedRemovalNote(live, PLATFORM_LABELS) } : {}),
              ...(undoRequest
                ? {
                    duration: 10_000,
                    action: { label: "Undo", onClick: () => void restoreRemoved(undoRequest, item.title) }
                  }
                : {})
            });
          }
          if (result.youtubeMayExist) {
            toast.warning("A video may still be on YouTube for this post. Check YouTube Studio.", {
              action: { label: "Open Studio", onClick: () => window.open("https://studio.youtube.com", "_blank", "noopener") }
            });
          }
          if (result.facebookPostId) {
            toast.warning("Facebook already holds this post and will still publish it at its time.", {
              description: "Facebook posts cannot be cancelled from here.",
              duration: 12_000,
              action: { label: "Open Facebook", onClick: () => window.open(FACEBOOK_SCHEDULED_POSTS_URL, "_blank", "noopener") }
            });
          }
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh, restoreRemoved, timezone]
  );

  /**
   * Edits the caption of a queued post. This changes the QUEUE only: the
   * platforms read the caption when they post, so legs that have not gone out
   * pick it up; a YouTube video already uploaded keeps the description it was
   * uploaded with, and the toast says so with a Studio link.
   */
  const editQueueCaption = useCallback(
    async (item: QueueItem, caption: string) => {
      const trimmed = caption.trim();
      if (!trimmed || trimmed === (item.caption ?? "").trim()) return;
      setQueueItems((prev) => prev.map((candidate) => (candidate.id === item.id ? { ...candidate, caption: trimmed } : candidate)));
      try {
        const response = await fetch(`/api/publish/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption: trimmed })
        });
        if (!response.ok) throw new Error(await readError(response));
        const youtubeId = item.platforms.youtube?.postId;
        toast.success("Caption saved on the queued post.", {
          description: youtubeId ? "YouTube's description is not changed - edit it in YouTube Studio." : undefined,
          action: youtubeId
            ? { label: "Open in Studio", onClick: () => window.open(studioVideoUrl(youtubeId), "_blank", "noopener") }
            : undefined
        });
      } catch (error) {
        errorToast(error instanceof Error ? error.message : "Could not save the caption.");
        await refresh();
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
          errorToast(await readError(response));
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
          errorToast(await readError(response));
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

  /**
   * "Retry posts that lost their connection": puts the posts that FAILED
   * because their connection lapsed back to pending, for exactly the accounts
   * the strip says are connected now (planConnectionRetry) - never a platform
   * with no connection, where the posts would only fail again. "manual"
   * reminders are not touched (the user may have posted those by hand),
   * rejected videos stay failed, and a failure whose slot is more than
   * REARM_MAX_SLOT_AGE_HOURS gone stays failed too: re-armed, it would post the
   * moment the runner next ran. A post that already reached the platform
   * resumes rather than uploading twice (rearm.ts). The next runner pass, or
   * Publish now, sends them.
   *
   * The toast says what happened platform by platform (describeRearmResults).
   */
  const rearmConnectionFailures = useCallback(
    async (targets: Array<{ platform: PlatformId; accountId: string }>) => {
      if (targets.length === 0) return 0;
      setBusy("rearm");
      const byPlatform = new Map<PlatformId, RearmPlatformResult>();
      try {
        for (const { platform, accountId } of targets) {
          const result = byPlatform.get(platform) ?? { platform, recovered: 0, skippedOld: 0 };
          byPlatform.set(platform, result);
          try {
            const response = await fetch("/api/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "rearm",
                platform,
                accountId,
                statuses: ["failed"],
                maxSlotAgeHours: REARM_MAX_SLOT_AGE_HOURS
              })
            });
            if (!response.ok) {
              result.error ??= await readError(response);
              continue;
            }
            const body = (await response.json()) as { recovered?: number; skippedOld?: number };
            result.recovered += body.recovered ?? 0;
            result.skippedOld += body.skippedOld ?? 0;
          } catch {
            result.error ??= "Network error while retrying.";
          }
        }
        const results = [...byPlatform.values()];
        const { tone, message } = describeRearmResults(results);
        if (tone === "success") toast.success(message);
        else if (tone === "warning") toast.warning(message);
        else errorToast(message);
        await refresh();
        return results.reduce((sum, result) => sum + result.recovered, 0);
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  return {
    loaded: loaded && accountsLoaded,
    loadError,
    refreshing,
    accountsError,
    accountsRefreshing,
    channelError,
    channelRefreshing,
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
    bookingSummary,
    dismissBookingSummary: () => {
      if (activeJob) setBookingSummaryFor(activeJob.id, null);
    },
    renameClip,
    renameQueueItem,
    tailorCaption,
    tailorCaptionsForAll,
    captionProgress,
    /** Clip key → why its AI caption failed, for the cards and the retry. */
    captionFailures,
    /** The last caption request came back as the clip title: no model answered. */
    aiCopyFellBack,
    schedule,
    uploadToSlot,
    autoAssign,
    publishNow,
    retryQueueItem,
    editQueueCaption,
    remove,
    rearmConnectionFailures,
    refresh,
    refreshOverview,
    refreshAccounts,
    refreshChannel
  };
}
