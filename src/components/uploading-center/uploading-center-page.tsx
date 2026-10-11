"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Facebook,
  Instagram,
  Loader2,
  Music2,
  Play,
  RotateCcw,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle, makeClipProject, makeTitleOverlay } from "@/lib/clipping/editor";
import { writeDraftProject } from "@/components/editor/drafts";
import { useAppData } from "@/components/providers/app-provider";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { OAuthLandingBanner, useOAuthLanding } from "@/components/layout/oauth-landing";
import { WorkflowLoadNotice } from "@/components/marketing/workflow-load-notice";
import { Tabs } from "@/components/ui/tabs";
import { AccountSwitcher } from "@/components/uploading-center/account-switcher";
import { ClipQueue } from "@/components/uploading-center/clip-queue";
import { NO_AI_CAPTION_SUMMARY_NOTE, zoneTimeLabel } from "@/components/uploading-center/schedule-summary";
import { clipsNeedingCaption, nameClips, planAutoAssign, type ShortsCap } from "@/components/uploading-center/bulk";
import { createDraftBook, type DraftMap } from "@/components/uploading-center/draft-book";
import {
  collectFailedLegs,
  failureCounts,
  planConnectionRetry,
  retryConnectionHelp,
  retryConnectionLabel,
  tabLabelWithFailures,
  type ConnectionRetryPlan,
  type FailedLeg,
} from "@/components/uploading-center/failures";
import {
  DEFAULT_RUN_DEFAULTS,
  draftWithDefaults,
  hydrateDraft,
  readClipDrafts,
  readRunDefaults,
  redraftWithDefaults,
  writeClipDraft,
  writeRunDefaults,
  type RunDefaults,
} from "@/components/uploading-center/run-defaults";
import { QuotaMeter } from "@/components/uploading-center/quota-meter";
import { ScheduleBoard } from "@/components/uploading-center/schedule-board";
import { StatusChip } from "@/components/uploading-center/status-chip";
import {
  DEFAULT_SLOT_OFFSET_DAYS,
  NO_AI_CAPTION_NOTICE,
  NO_AI_CAPTION_NOTICE_PLURAL,
  PLATFORM_LABELS,
  PLATFORM_TARGET_LABELS,
  REARM_MAX_SLOT_AGE_HOURS,
  SLOT_WINDOW_DAYS,
  copyPlatformFor,
  copyTargetLabel,
  platformTargetLabels,
  studioContentUrl,
  studioVideoUrl,
  targetPlatforms,
  useUploadingCenter,
  type ClipDraft,
  type PlatformTarget,
  type ReadyClip,
  type UploadSuccess,
} from "@/components/uploading-center/use-uploading-center";
import { buildAgenda } from "@/lib/publisher/agenda";
import { dateTimeFormat } from "@/lib/publisher/intl";
import { publisherBannerLine } from "@/lib/publisher/publishOverview";
import { EARLIEST_PUBLISH_DAY_OFFSET, addDaysToDateKey } from "@/lib/publisher/schedule";
import { clearConnectFailure, rememberConnectFailure } from "@/lib/publisher/connectErrors";
import { shortsByDay } from "@/lib/publisher/shortsCap";
import { slotOffsetForDateKey } from "@/lib/publisher/slotWindow";
import {
  DEFAULT_SLOT_TIMES,
  DEFAULT_WEEKEND_SLOT_TIMES,
  type ScheduleSlot
} from "@/lib/publisher/slots";
import { localCalendarParts } from "@/lib/publisher/time";
import { ALL_PLATFORMS, type PlatformId, type QueueItem } from "@/lib/publisher/types";

const PLATFORM_TABS: Array<{ id: PlatformId; icon: typeof Youtube }> = [
  { id: "youtube", icon: Youtube },
  { id: "tiktok", icon: Music2 },
  { id: "instagram", icon: Instagram },
  { id: "facebook", icon: Facebook },
];

export function UploadingCenterPage() {
  // Clip Editor projects live in the shared app store; the Uploading Center
  // needs them to tell when a clip's trim/edits are newer than its render.
  const { data: appData, mutate } = useAppData();
  const clipProjects = appData.clipProjects;

  const {
    loaded,
    loadError,
    refreshing,
    accountsError,
    accountsRefreshing,
    channelError,
    channelRefreshing,
    overview,
    queueItems,
    slots,
    slotOffsetDays,
    setSlotOffsetDays,
    channel,
    channelVideos,
    channelVideosBySlot,
    itemsByPlatform,
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
    thumbnailForItem,
    busy,
    uploadSuccess,
    dismissUploadSuccess,
    renameClip,
    renameQueueItem,
    tailorCaption,
    tailorCaptionsForAll,
    captionProgress,
    captionFailures,
    aiCopyFellBack,
    schedule,
    uploadToSlot,
    autoAssign,
    bookingSummary,
    dismissBookingSummary,
    publishNow,
    retryQueueItem,
    editQueueCaption,
    remove,
    rearmConnectionFailures,
    refresh,
    refreshAccounts,
    refreshChannel,
  } = useUploadingCenter(clipProjects);
  const activeYoutubeAccountId = activeAccountIds.youtube;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Who each platform posts as doesn't change on its own — read it once rather
  // than asking four platforms for the same profiles every minute.
  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  // Switching a platform's account switches whose channel the calendar shows.
  const switchedAccountRef = useRef(false);
  useEffect(() => {
    if (!switchedAccountRef.current) {
      switchedAccountRef.current = true;
      return;
    }
    void refreshChannel({ accountId: activeYoutubeAccountId });
  }, [activeYoutubeAccountId, refreshChannel]);

  // The 60-second poll doubles as the TikTok/Instagram manual-reminder tick
  // (YouTube self-publishes); it's a no-op when nothing changed.
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // The platform and hashtags this run of clips is aimed at, picked once for
  // the whole job instead of on every card. Read after mount: localStorage in
  // the useState initializer would make the first client render disagree with
  // the server HTML.
  const [runDefaults, setRunDefaults] = useState<RunDefaults>(DEFAULT_RUN_DEFAULTS);
  useEffect(() => {
    queueMicrotask(() => {
      const stored = readRunDefaults();
      if (stored) setRunDefaults(stored);
    });
  }, []);

  // One draft (title/caption/target/slot) per clip card, kept up here so a
  // drag-drop onto the board uses whatever was typed on the card. The title
  // itself is persisted to the backend clip on commit (blur/Enter); the caption
  // and target are saved in the browser, because losing an AI-written caption
  // to a reload or a job switch was the whole cost of this screen.
  const [drafts, setDrafts] = useState<DraftMap>({});
  // Every write goes through the book, which is current the instant it is made;
  // `drafts` is only what the cards render. A bulk action reads the book right
  // after its last write, with no render in between (see draft-book.ts).
  const [draftBook] = useState(() => createDraftBook(setDrafts));
  const draftFor = useCallback(
    (clip: ReadyClip): ClipDraft => drafts[clip.key] ?? draftWithDefaults(clip, runDefaults),
    [drafts, runDefaults],
  );
  const putDraft = useCallback((clip: ReadyClip, draft: ClipDraft) => {
    draftBook.put(clip.key, draft);
    writeClipDraft(clip.key, draft, clip.headline);
  }, [draftBook]);

  // Restore saved drafts for whichever run is on screen. Clips with nothing
  // saved are left out of the map on purpose, so they keep following the run
  // defaults as those change.
  useEffect(() => {
    if (readyClips.length === 0) return;
    queueMicrotask(() => {
      const stored = readClipDrafts();
      draftBook.update((current) => {
        let next = current;
        for (const clip of readyClips) {
          if (next[clip.key] || !stored[clip.key]) continue;
          if (next === current) next = { ...current };
          next[clip.key] = hydrateDraft(
            draftWithDefaults(clip, runDefaults),
            stored[clip.key],
            clip.headline,
          );
        }
        return next;
      });
    });
  }, [draftBook, readyClips, runDefaults]);

  // Changing the run defaults re-aims the cards already on screen, not just the
  // ones drawn next — dropped hashtags leave every title, new ones join it.
  const onRunDefaultsChange = useCallback(
    (next: RunDefaults) => {
      setRunDefaults(next);
      writeRunDefaults(next);
      const updated: Record<string, ClipDraft> = {};
      const latest = draftBook.read();
      for (const clip of readyClips) {
        const existing = latest[clip.key];
        if (!existing) continue;
        const redrafted = redraftWithDefaults(existing, runDefaults, next);
        updated[clip.key] = redrafted;
        writeClipDraft(clip.key, redrafted, clip.headline);
      }
      draftBook.update((current) => ({ ...current, ...updated }));
    },
    [draftBook, readyClips, runDefaults],
  );

  const onDraftChange = useCallback(
    (clip: ReadyClip, draft: ClipDraft) => {
      putDraft(clip, draft);
    },
    [putDraft],
  );
  const onTitleCommit = useCallback(
    (clip: ReadyClip) => {
      const draft = drafts[clip.key];
      if (!draft || draft.title.trim() === clip.headline) return;
      void renameClip(clip, draft.title);
    },
    [drafts, renameClip],
  );

  // Fill a clip's caption with AI copy tailored to whatever platform its card
  // targets, then surface the suggested best posting time as a hint.
  const onTailorCaption = useCallback(
    async (clip: ReadyClip) => {
      const draft = draftFor(clip);
      const result = await tailorCaption(clip, copyPlatformFor(draft.platform), draft.title);
      if (!result) return;
      putDraft(clip, { ...(draftBook.read()[clip.key] ?? draft), caption: result.caption });
      const label = copyTargetLabel(draft.platform);
      if (result.source === "fallback") {
        // No model answered; the caption is the clip title. Never call that "tailored".
        toast.warning(NO_AI_CAPTION_NOTICE, { id: "caption-fallback" });
        return;
      }
      if (result.bestTime) {
        toast.success(
          `Tailored for ${label}. Best time to post${draft.platform === "all" ? " on TikTok" : ""}: ~${result.bestTime}.`
        );
      } else {
        toast.success(`Caption tailored for ${label}.`);
      }
    },
    [draftBook, draftFor, putDraft, tailorCaption],
  );

  // Surface the OAuth redirect result: an inline banner plus a toast raised
  // after mount (the toaster is not listening yet while this page's first
  // effects run), then the params leave the address. The effect below keeps
  // only what the landing changes in the page itself.
  const searchParams = useSearchParams();
  const router = useRouter();
  const { landing: oauthLanding, dismiss: dismissOauthLanding } = useOAuthLanding({
    action: { label: "Open Settings", href: "/settings#accounts" },
  });
  const oauthHandled = useRef(false);
  useEffect(() => {
    if (oauthHandled.current) return;
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    if (connected === "tiktok" || connected === "youtube") clearConnectFailure(connected);
    if (connected === "tiktok") {
      oauthHandled.current = true;
    } else if (connected === "youtube") {
      oauthHandled.current = true;
      // A non-primary connection carries its account id — switch the YouTube
      // tab to that account so the fresh connection is what's on screen.
      const accountParam = searchParams.get("account");
      if (accountParam) setActiveAccount("youtube", accountParam);
    } else if (connectError) {
      oauthHandled.current = true;
      // The same message waits in the platform's row in Settings > Accounts
      // after the banner and toast are gone.
      const platform = searchParams.get("connect");
      if (platform) rememberConnectFailure(platform, connectError);
    }
  }, [searchParams, setActiveAccount]);

  // Auto Assign avoids double-booking a slot: it's taken by a queue item or —
  // on YouTube — by a video already scheduled/published on the channel itself
  // at (or within a few minutes of) that time, uploaded here or by hand.
  const itemAtSlot = useCallback(
    (platform: PlatformId, slotUtc: string) =>
      itemsByPlatformSlot.get(platform)?.get(slotUtc),
    [itemsByPlatformSlot],
  );
  const isSlotTaken = useCallback(
    (platform: PlatformId, slotUtc: string) =>
      Boolean(itemAtSlot(platform, slotUtc)) ||
      (platform === "youtube" && channelVideosBySlot.has(slotUtc)),
    [itemAtSlot, channelVideosBySlot],
  );
  // A clip card aimed at "All platforms" needs a slot that is free on every
  // one of them — it posts to all four at that time.
  const isTargetSlotTaken = useCallback(
    (target: PlatformTarget, slotUtc: string) =>
      targetPlatforms(target).some((platform) => isSlotTaken(platform, slotUtc)),
    [isSlotTaken],
  );

  // The daily short-form cap the server enforces, as the screen needs it: what
  // each local day already holds (every platform and account; the cap counts
  // distinct videos, so one clip on three platforms is one short), the days that
  // are full, and a check the pickers share.
  const publishingOn = overview?.enabled !== false;
  const shortsPerDay = overview?.shortsPerDay;
  const timezone = overview?.timezone ?? "UTC";
  const shortsBooked = useMemo(() => shortsByDay(queueItems, timezone), [queueItems, timezone]);
  const shortsCap = useMemo<ShortsCap | undefined>(
    () => (shortsPerDay ? { limit: shortsPerDay, booked: shortsBooked } : undefined),
    [shortsBooked, shortsPerDay],
  );
  const shortsFullDays = useMemo(() => {
    const full = new Set<string>();
    if (shortsPerDay) for (const [day, count] of shortsBooked) if (count >= shortsPerDay) full.add(day);
    return full;
  }, [shortsBooked, shortsPerDay]);
  const slotDayKey = useMemo(() => new Map(slots.map((slot) => [slot.utc, slot.dateKey])), [slots]);
  // Tomorrow, in the publish timezone: the earliest day anything books onto.
  const tomorrowKey = useMemo(() => {
    const today = slots.find((slot) => slot.today)?.dateKey;
    return today ? addDaysToDateKey(today, EARLIEST_PUBLISH_DAY_OFFSET) : undefined;
  }, [slots]);
  // For the cards' slot pickers: a slot is unavailable when it is taken, or when
  // its day is full: a new clip is one short however many platforms it targets.
  const isSlotUnavailable = useCallback(
    (target: PlatformTarget, slotUtc: string) => {
      if (isTargetSlotTaken(target, slotUtc)) return true;
      if (!shortsCap) return false;
      const day = slotDayKey.get(slotUtc);
      if (!day) return false;
      return (shortsCap.booked.get(day) ?? 0) >= shortsCap.limit;
    },
    [isTargetSlotTaken, shortsCap, slotDayKey],
  );
  const targetLabels = useMemo(() => platformTargetLabels(overview?.mirror), [overview?.mirror]);

  // Placement mode: the editor's Schedule Short button lands here with
  // ?scheduleJob=…&scheduleClip=…; that clip is pre-selected and every open
  // slot becomes a one-click target (dragging still works too).
  const [placingKey, setPlacingKey] = useState<string | null>(null);
  const placementConsumed = useRef(false);
  const scheduleJobParam = searchParams.get("scheduleJob");
  const scheduleClipParam = searchParams.get("scheduleClip");
  // ?job=… opens on that run's clips. The Stream Pipeline used to link here
  // with nothing at all, so a run's outputs had to be found by guessing which
  // job in the dropdown was the right one.
  const jobParam = searchParams.get("job");
  const itemParam = searchParams.get("item");
  const dayParam = searchParams.get("day");
  const jobParamConsumed = useRef(false);
  const focusKeyRef = useRef<string | null>(null);
  // Days before today are folded away on load so the page opens at its top.
  const [showEarlierDays, setShowEarlierDays] = useState(false);
  // Bumped to run the "scroll to the post" effect again for the same ?item=,
  // which is what pressing a failure's Show button twice needs.
  const [focusNonce, setFocusNonce] = useState(0);
  useEffect(() => {
    if (itemParam || dayParam) return;
    if (!jobParam || jobParamConsumed.current) return;
    jobParamConsumed.current = true;
    setActiveJobId(jobParam);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("job");
    const next = params.toString();
    router.replace(next ? `/uploading-center?${next}` : "/uploading-center");
  }, [dayParam, itemParam, jobParam, router, searchParams, setActiveJobId]);

  // Something asked to be shown (?item=, ?day=) on a day before today: the
  // folded "earlier days" must be open for it to be on the page at all. Derived
  // at render, not set from the effect below, so it needs no extra pass.
  const { focusIsEarlier, focusDateKey } = useMemo(() => {
    const timeZone = overview?.timezone ?? "America/Toronto";
    const queued = itemParam ? [...itemsByPlatform.values()].flat().find((entry) => entry.id === itemParam) : undefined;
    const dateKey = queued ? localCalendarParts(queued.publishAt, timeZone).dateKey : dayParam;
    return {
      focusIsEarlier: Boolean(dateKey && dateKey < localCalendarParts(new Date(), timeZone).dateKey),
      focusDateKey: dateKey ?? null,
    };
  }, [dayParam, itemParam, itemsByPlatform, overview?.timezone]);

  useEffect(() => {
    if (!loaded) return;
    const focusKey = `${itemParam ?? ""}:${dayParam ?? ""}`;
    if (focusKey === ":" || focusKeyRef.current === focusKey) return;

    const queued = [...itemsByPlatform.values()].flat();
    const item: QueueItem | undefined = itemParam ? queued.find((entry) => entry.id === itemParam) : undefined;
    if (itemParam && !item) return;

    if (item?.jobId) setActiveJobId(item.jobId);

    const timeZone = overview?.timezone ?? "America/Toronto";
    const dateKey = item ? localCalendarParts(item.publishAt, timeZone).dateKey : dayParam;
    if (!dateKey) return;
    const todayKey = localCalendarParts(new Date(), timeZone).dateKey;
    const offset = slotOffsetForDateKey(dateKey, todayKey);
    if (offset !== slotOffsetDays) {
      setSlotOffsetDays(offset);
      return;
    }
    // (A day before today is folded behind "Show earlier days"; `focusIsEarlier`
    // above opens it while something asks to be shown there.)
    // The board is drawn by the tab that is showing, a frame or two after the
    // tab/account switch and the window change land, so look for the post for
    // a few frames rather than once. A post on several platforms is drawn once
    // per tab and only one of those tabs is showing - scroll to that one.
    // INSTANT, not smooth: a smooth scroll is cancelled by the layout shifts
    // that follow (images, the board re-rendering) and ends nowhere near.
    const targetId = itemParam ? `queue-item-${itemParam}` : `agenda-day-${dateKey}`;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[id="${targetId}"]`));
      const target = candidates.find((candidate) => candidate.offsetParent !== null);
      if (target) {
        focusKeyRef.current = focusKey;
        target.scrollIntoView({ behavior: "auto", block: "center" });
      } else if ((tries += 1) < 40) {
        frame = requestAnimationFrame(attempt);
      }
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [
    dayParam,
    focusNonce,
    itemParam,
    itemsByPlatform,
    loaded,
    overview?.timezone,
    setActiveJobId,
    setSlotOffsetDays,
    slotOffsetDays
  ]);

  // The board opens ON today: the days before it sit behind "Show earlier
  // days" (see earlier-days.ts) instead of the page being scrolled down to
  // today, which left the Failed strip, the platform tabs and the bulk button
  // above the fold.

  // The Failed strip's Show button: switch to the failure's platform tab and
  // account, then bring the post into view through the ?item= route above.
  const showQueueItem = useCallback(
    (item: QueueItem, platform: PlatformId, accountId: string) => {
      setActiveAccount(platform, accountId);
      focusKeyRef.current = null;
      const params = new URLSearchParams(searchParams.toString());
      params.set("platform", platform);
      params.set("item", item.id);
      params.delete("day");
      router.replace(`/uploading-center?${params.toString()}`, { scroll: false });
      setFocusNonce((current) => current + 1);
    },
    [router, searchParams, setActiveAccount],
  );
  const jumpToFailure = useCallback(
    (leg: FailedLeg) => showQueueItem(leg.item, leg.platform, leg.accountId),
    [showQueueItem],
  );
  useEffect(() => {
    if (
      placementConsumed.current ||
      !loaded ||
      !scheduleJobParam ||
      !scheduleClipParam
    )
      return;
    let cancelled = false;
    // Deferred so the state updates land after the render pass, not inside it.
    queueMicrotask(() => {
      if (cancelled || placementConsumed.current) return;
      setActiveJobId(scheduleJobParam);
      // The clip is matched by any file it was ever postable as, so the param
      // can be the editor's source file while the card shows the edited render.
      const clip = readyClips.find(
        (candidate) =>
          candidate.jobId === scheduleJobParam &&
          candidate.allFiles.includes(scheduleClipParam),
      );
      if (!clip) return; // readyClips still switching to that job — retry on the next render
      placementConsumed.current = true;
      setPlacingKey(clip.key);
      router.replace("/uploading-center");
    });
    return () => {
      cancelled = true;
    };
  }, [
    loaded,
    readyClips,
    router,
    scheduleClipParam,
    scheduleJobParam,
    setActiveJobId,
  ]);
  const placingClip = useMemo(
    () =>
      placingKey
        ? (readyClips.find((clip) => clip.key === placingKey) ?? null)
        : null,
    [placingKey, readyClips],
  );

  const handleSchedule = useCallback(
    (clip: ReadyClip, override?: Partial<ClipDraft>) =>
      schedule(
        clip,
        { ...draftFor(clip), ...override },
        {
          // A caption written for an empty box lands in the box, so the card
          // shows what was booked instead of staying blank.
          onCaption: (caption) => putDraft(clip, { ...(draftBook.read()[clip.key] ?? draftFor(clip)), caption }),
        },
      ),
    [draftBook, draftFor, putDraft, schedule],
  );

  // "Edit clip" → open this clip in the Clip Editor (the mirror of the editor's
  // "Schedule Short" that lands back here). Resume the clip's most recently
  // edited project if it has one; otherwise build a fresh project from the
  // clip's trim and captions, exactly as the Clip Generator does.
  const editClip = useCallback(
    (clip: ReadyClip) => {
      if (!activeJob) return;
      const index = activeJob.clips.findIndex(
        (candidate) => candidate.id === clip.clipId,
      );
      const candidate = index >= 0 ? activeJob.clips[index] : null;
      const sourceFile = candidate?.file;
      if (!candidate || !sourceFile) return;
      const existing = clipProjects
        .filter((p) => p.jobId === activeJob.id && p.sourceFile === sourceFile)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (existing) {
        const params = new URLSearchParams({
          open: existing.id,
          job: activeJob.id,
          file: sourceFile,
          clip: String(index),
        });
        router.push(`/editor?${params.toString()}`);
        return;
      }
      const project = makeClipProject({
        jobId: activeJob.id,
        name: `${activeJob.fileName} - clip ${index + 1}`,
        sourceFile,
        posterFile: candidate.posterFile,
        sourceUrl: activeJob.sourceUrl,
        clipStart: candidate.start,
        clipEnd: candidate.end,
        sourceFrame: candidate.sourceFrame,
        output: activeJob.output,
      });
      const windowed = windowSegments(activeCaptions, candidate.start, candidate.end);
      const words = windowed.flatMap((segment) => segment.words);
      project.captions = words.length
        ? chunkWords(words, project.captionStyle.maxWordsPerCaption)
        : windowed;
      project.title = candidate.title || generateClipTitle(project.captions, `Clip ${index + 1}`);
      if (project.title) project.name = project.title;
      project.overlays = [...project.overlays, makeTitleOverlay(project)];
      writeDraftProject(project);
      const params = new URLSearchParams({
        open: project.id,
        job: activeJob.id,
        file: sourceFile,
        clip: String(index),
      });
      router.push(`/editor?${params.toString()}`);
      void mutate("upsertClipProject", project);
    },
    [activeCaptions, activeJob, clipProjects, mutate, router],
  );
  const handleDrop = useCallback(
    (platform: PlatformId, slotUtc: string, clipKey: string) => {
      const clip = readyClips.find((candidate) => candidate.key === clipKey);
      if (!clip) return;
      void handleSchedule(clip, { platform, slotUtc }).then((ok) => {
        if (ok && clipKey === placingKey) setPlacingKey(null);
      });
    },
    [handleSchedule, placingKey, readyClips],
  );
  const handleSelectSlot = useCallback(
    (platform: PlatformId, slotUtc: string) => {
      if (!placingClip || busy) return;
      void handleSchedule(placingClip, { platform, slotUtc }).then((ok) => {
        if (ok) setPlacingKey(null);
      });
    },
    [busy, handleSchedule, placingClip],
  );


  // Read through the ref, not through `drafts`: the bulk actions below await
  // between clips, and each one has to see the captions the previous ones wrote.
  const latestDraftFor = useCallback(
    (clip: ReadyClip): ClipDraft => draftBook.read()[clip.key] ?? draftWithDefaults(clip, runDefaults),
    [draftBook, runDefaults],
  );
  const isScheduled = useCallback(
    (clip: ReadyClip) => itemsForClip(clip).length > 0,
    [itemsForClip],
  );
  const captionsMissing = useMemo(
    () => clipsNeedingCaption({ clips: readyClips, draftFor, isScheduled }).length,
    [draftFor, isScheduled, readyClips],
  );
  const unscheduledCount = useMemo(
    () => readyClips.filter((clip) => itemsForClip(clip).length === 0).length,
    [readyClips, itemsForClip],
  );

  // "AI captions for all": write a caption for every unscheduled clip that
  // hasn't got one, tailored to whatever platform each card targets.
  const fillCaptions = useCallback(
    async (clips: ReadyClip[], options?: { deferFallbackNotice?: boolean }) => {
      const targets = clips.map((clip) => {
        const draft = latestDraftFor(clip);
        return { clip, platform: copyPlatformFor(draft.platform), title: draft.title };
      });
      return tailorCaptionsForAll(
        targets,
        (clip, caption) => {
          putDraft(clip, { ...latestDraftFor(clip), caption });
        },
        options,
      );
    },
    [latestDraftFor, putDraft, tailorCaptionsForAll],
  );
  const handleCaptionsForAll = useCallback(() => {
    const missing = clipsNeedingCaption({ clips: readyClips, draftFor: latestDraftFor, isScheduled });
    if (missing.length === 0) {
      toast.info("Every unscheduled clip in this run already has a caption.");
      return;
    }
    void fillCaptions(missing);
  }, [fillCaptions, isScheduled, latestDraftFor, readyClips]);

  // The clips whose AI caption failed, in card order — what the retry button
  // runs again. A clip the user then captioned by hand drops off the list: it
  // has copy now, and the next pass would skip it anyway.
  const failedCaptionClips = useMemo(
    () =>
      readyClips.filter(
        (clip) => Boolean(captionFailures[clip.key]) && !draftFor(clip).caption.trim(),
      ),
    [captionFailures, draftFor, readyClips],
  );
  const handleRetryCaptions = useCallback(() => {
    if (failedCaptionClips.length === 0) return;
    void fillCaptions(failedCaptionClips);
  }, [failedCaptionClips, fillCaptions]);

  // Auto Assign: post every not-yet-scheduled clip in this run the way it would
  // have been posted by hand — the run's platform and hashtags, an AI caption
  // for anything still blank, then the next open slot for each card's platform.
  const handleAutoAssign = useCallback(async () => {
    if (!publishingOn) {
      toast.error("Posting is off, so nothing can be booked. Turn it on in Settings.");
      return;
    }
    const missing = clipsNeedingCaption({ clips: readyClips, draftFor: latestDraftFor, isScheduled });
    // Booking follows, so the "no AI key" notice waits and is worded for what is true then:
    // before booking it asks for an edit, after booking it points at each post's Caption button.
    const pass = missing.length > 0 ? await fillCaptions(missing, { deferFallbackNotice: true }) : null;
    const usedTitles = (pass?.usedTitle ?? 0) > 0 && (pass?.failed.length ?? 0) === 0;
    // Nothing booked: the toast is all there is, and it asks for an edit before booking.
    // Booked: the sentence rides in the booking summary, which stays until dismissed.
    const sayNoAiKey = () => {
      if (usedTitles) toast.warning(NO_AI_CAPTION_NOTICE_PLURAL, { id: "caption-fallback" });
    };
    // A clip whose caption failed is NOT scheduled. Posting it anyway would send
    // fallback copy under a success toast, which is indistinguishable from a
    // clip that was captioned properly — the retry button is the way back.
    const skipKeys = new Set((pass?.failed ?? []).map((failure) => failure.clip.key));
    const { assignments, unslotted, capBlocked, heldBack } = planAutoAssign({
      clips: readyClips,
      draftFor: latestDraftFor,
      isScheduled,
      slots,
      isTargetSlotTaken,
      skipKeys,
      shortsCap,
    });
    // The days in this window that are at the shorts limit, said once, so
    // "no open slots" never hides that the slots are there but the days are full.
    const fullDaysNote = shortsCap
      ? `Every open day in this window already holds ${shortsCap.limit} short${shortsCap.limit === 1 ? "" : "s"} - page the calendar forward to book later.`
      : "";
    if (assignments.length === 0) {
      sayNoAiKey();
      if (heldBack.length > 0) {
        toast.error(
          `Nothing scheduled — no AI caption for ${nameClips(heldBack.map((clip) => clip.headline))}. Retry the captions, or write them yourself.`,
        );
        return;
      }
      toast.info(
        capBlocked > 0
          ? `Nothing scheduled. ${fullDaysNote}`
          : unslotted > 0
            ? "No open slots left on the schedule."
            : "Every clip in this run is already scheduled.",
      );
      return;
    }
    if (unslotted > 0) {
      toast.info(
        capBlocked > 0
          ? `${unslotted} clip${unslotted === 1 ? "" : "s"} left unassigned. ${fullDaysNote}`
          : `${unslotted} clip${unslotted === 1 ? "" : "s"} left unassigned — the schedule ran out of open slots.`,
      );
    }
    await autoAssign(assignments, heldBack, usedTitles ? NO_AI_CAPTION_SUMMARY_NOTE : undefined);
  }, [
    autoAssign,
    fillCaptions,
    isScheduled,
    isTargetSlotTaken,
    latestDraftFor,
    publishingOn,
    readyClips,
    shortsCap,
    slots,
  ]);

  // The whole calendar for each platform: every queued post and every video
  // already on the channel, each placed on the day it goes live at its real
  // time — plus the open slots that day. Nothing is left to float in a list.
  // Memoized on the four things it reads, because the tab list is rebuilt on
  // every render — including every keystroke in a caption box.
  const agendas = useMemo(() => {
    const timeZone = overview?.timezone ?? "UTC";
    return new Map(
      PLATFORM_TABS.map(({ id }) => {
        const days = buildAgenda({
          slots,
          queueItems: itemsByPlatform.get(id) ?? [],
          channelVideos: id === "youtube" ? channelVideos : [],
          timeZone,
          shortsFullDays,
        });
        // With posting off the board is a read-only record: nothing it could
        // offer as a drop target would be accepted.
        return [id, publishingOn ? days : days.map((day) => ({ ...day, openSlots: [] }))];
      }),
    );
  }, [channelVideos, itemsByPlatform, overview?.timezone, publishingOn, shortsFullDays, slots]);

  // The publisher's own state (paused, runner installed, last run), recomputed
  // each time the overview is read so "ran 12 min ago" tracks the 60s poll.
  const publisherLine = useMemo(
    () => publisherBannerLine(overview?.automation, new Date()),
    [overview],
  );

  // Failures across every platform tab and account, so the strip at the top can
  // list them all and each tab can say how many it holds.
  const failedLegs = useMemo(() => collectFailedLegs(queueItems), [queueItems]);
  const failedByPlatform = useMemo(() => failureCounts(failedLegs), [failedLegs]);
  // What "retry the connection failures" can really do: only accounts that are
  // connected NOW, so a platform still waiting on its credentials is named, not retried.
  const retryPlan = useMemo(
    () =>
      planConnectionRetry(failedLegs, {
        now: new Date(),
        maxSlotAgeHours: REARM_MAX_SLOT_AGE_HOURS,
        isConnected: (platform, accountId) =>
          accounts.some((account) => account.platform === platform && account.id === accountId && account.connected),
      }),
    [accounts, failedLegs],
  );
  // Whether the account a post uses on a platform has a connection. The board's
  // cards read it for every leg, not just the tab's active account. A post's
  // accountId names ONE account; on a platform it does not belong to, the
  // platform's primary account is the one that posts. Until the account list
  // has loaded nothing is known, so nothing is claimed unconnected.
  const isAccountConnected = useCallback(
    (platform: PlatformId, accountId: string) => {
      if (accounts.length === 0) return true;
      const own =
        accounts.find((account) => account.platform === platform && account.id === accountId) ??
        accounts.find((account) => account.platform === platform && account.primary);
      return own?.connected ?? false;
    },
    [accounts],
  );
  // The platform tab on screen, read the way the tab strip reads it (?platform=).
  const platformParam = searchParams.get("platform");
  const activePlatform: PlatformId =
    PLATFORM_TABS.find(({ id }) => id === platformParam)?.id ?? PLATFORM_TABS[0]!.id;

  // A booked clip's "Show on the board": the tab the board is already on when
  // the post has a leg there, otherwise the first platform it is booked on.
  const showBookedItem = useCallback(
    (item: QueueItem) => {
      const legs = ALL_PLATFORMS.filter((platform) => item.platforms[platform]);
      const platform = legs.includes(activePlatform) ? activePlatform : (legs[0] ?? activePlatform);
      // The post's accountId names ONE account; on a platform it does not
      // belong to, that platform's primary account is the one that posts.
      const own = accounts.some((account) => account.platform === platform && account.id === item.accountId);
      showQueueItem(item, platform, own && item.accountId ? item.accountId : `${platform}-primary`);
    },
    [accounts, activePlatform, showQueueItem],
  );

  const tabs = PLATFORM_TABS.map(({ id, icon }) => {
    const activeAccount = activeAccountFor(id);
    // Connection status follows the account the tab is showing, not the
    // platform as a whole — each account connects on its own.
    const configured = activeAccount?.connected ?? false;
    const days = agendas.get(id) ?? [];
    return {
      id,
      label: tabLabelWithFailures(PLATFORM_LABELS[id], failedByPlatform[id]),
      icon,
      content: (boardActive: boolean) => (
        <div className="space-y-4">
          <AccountSwitcher
            platform={id}
            accounts={accountsFor(id)}
            activeAccount={activeAccount}
            onSelect={(accountId) => setActiveAccount(id, accountId)}
            onAdd={(label) => addAccount(id, label)}
            onRemove={removeAccount}
            busy={busy}
          />
          {id === "youtube" && configured ? (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() =>
                  window.open(
                    studioContentUrl(channel?.channelId),
                    "_blank",
                    "noopener",
                  )
                }
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open YouTube
                Studio Content
              </Button>
            </div>
          ) : null}
          {id === "youtube" && !configured ? (
            <ConnectYoutubeNotice accountId={activeAccount?.id} primary={activeAccount?.primary} />
          ) : null}
          {id === "youtube" && configured && channel?.needsReconnect ? (
            <ReconnectYoutubeNotice accountId={activeAccount?.id} />
          ) : null}
          {id === "youtube" && channelRefreshing && !channel ? (
            <p className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading this account&apos;s YouTube schedule…</p>
          ) : null}
          {id === "tiktok" && !configured ? (
            <ConnectTiktokNotice
              accountId={activeAccount?.id}
              primary={activeAccount?.primary}
            />
          ) : null}
          {id !== "youtube" && id !== "tiktok" && !configured ? (
            <div className="tone-warning tone-edge tone-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <p className="tone-text flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <ReminderSentence platform={id} extraAccount={!activeAccount?.primary} />
              </p>
              {activeAccount?.primary ? <SettingsConnectionLink /> : null}
            </div>
          ) : null}
          {id === "tiktok" && configured ? (
            <p className="tone-success tone-edge tone-soft tone-text rounded-lg border px-3 py-2 text-xs">
              Until TikTok audits the app, clips land in your TikTok inbox to
              finish in the app instead of posting. Set TIKTOK_AUDITED=true once
              approved.
            </p>
          ) : null}
          <SchedulePeriodNav
            offsetDays={slotOffsetDays}
            slots={slots}
            onChange={setSlotOffsetDays}
          />
          {/* Only the tab on screen draws its board. Neighbouring tabs stay mounted
              so a switch is instant, but a hidden board is a second "Show earlier
              days" button, a second copy of every post id, in the page. */}
          {boardActive ? (
          <ScheduleBoard
            platform={id}
            days={days}
            thumbnailForItem={thumbnailForItem}
            onDropClip={(slotUtc, clipKey) => handleDrop(id, slotUtc, clipKey)}
            onUploadVideo={(slotUtc, file) =>
              void uploadToSlot(file, { platform: id, slotUtc })
            }
            onSelectSlot={
              placingClip
                ? (slotUtc) => handleSelectSlot(id, slotUtc)
                : undefined
            }
            onPublishNow={(item, platforms) => void publishNow(item, platforms)}
            onRetry={(item, retryPlatform) => void retryQueueItem(item, retryPlatform)}
            onEditCaption={(item, caption) => void editQueueCaption(item, caption)}
            onRemove={(item) => void remove(item)}
            onRename={(item, title) => void renameQueueItem(item, title)}
            youtubeQuotaFull={Boolean(overview && overview.quota.uploadsUsed >= overview.quota.budgetUploads)}
            isConnected={isAccountConnected}
            busy={busy}
            highlightedItemId={itemParam}
            shortsPerDay={shortsPerDay}
            readOnly={!publishingOn}
            collapseEarlier={!showEarlierDays && !focusIsEarlier}
            focusDateKey={focusDateKey}
            onShowEarlier={() => setShowEarlierDays(true)}
            timeZone={overview?.timezone}
          />
          ) : null}
          {id === "youtube" && (channelError || channel?.error) ? (
            <WorkflowLoadNotice title="The YouTube schedule could not be refreshed" message={channelError ?? channel?.error ?? "Try again."} retained={Boolean(channel?.fetchedAt)} retrying={channelRefreshing} onRetry={() => void refreshChannel({ force: true })} />
          ) : null}
        </div>
      ),
    };
  });

  // So an agent on the CoLateral canvas can read and drive this screen: the
  // run's platform/hashtags/window are the inputs worth exposing, the bulk
  // actions are the primary controls, and the readings are what the page is
  // reporting right now. Every setField/click below runs the exact handler
  // its on-screen counterpart runs — never a parallel path.
  const bulkBusy = busy === "auto-assign" || busy === "captions-all";
  useColateralSurface({
    route: "/uploading-center",
    title: "Uploading Center",
    summary: "Book finished clips onto the YouTube, TikTok, Instagram and Facebook posting schedule.",
    fields: [
      {
        id: "runPlatform",
        label: "Default platform for this run",
        value: runDefaults.platform,
        kind: "select",
        options: Object.keys(PLATFORM_TARGET_LABELS),
      },
      {
        id: "runHashtags",
        label: "Hashtags for this run",
        value: runDefaults.hashtags.join(" "),
        kind: "text",
        hint: "Space-separated hashtags appended to every new clip's title.",
      },
      {
        id: "scheduleOffsetDays",
        label: "Schedule window offset",
        value: slotOffsetDays,
        kind: "number",
        unit: "d",
        hint: `Days from today; ${DEFAULT_SLOT_OFFSET_DAYS} is the default window.`,
      },
      {
        id: "activeJobId",
        label: "Active clip run",
        value: activeJob?.id ?? "",
        kind: "select",
        options: jobsWithClips.map((job) => job.id),
      },
    ],
    controls: [
      ...(loadError || accountsError ? [{ id: "retry-load", label: "Retry loading clips and schedule", group: "Recovery", disabled: refreshing || accountsRefreshing }] : []),
      {
        id: "autoAssign",
        label: "Schedule at next free slots",
        group: "Queue",
        destructive: true,
        disabled: !loaded || bulkBusy || unscheduledCount === 0 || !publishingOn,
      },
      {
        id: "captionsForAll",
        label: "AI captions for all",
        group: "Queue",
        disabled: bulkBusy,
      },
      {
        id: "retryCaptions",
        label: "Retry failed captions",
        group: "Queue",
        disabled: bulkBusy || failedCaptionClips.length === 0,
      },
      {
        id: "cancelPlacement",
        label: "Cancel placement",
        group: "Queue",
        disabled: !placingClip,
      },
    ],
    readings: [
      { label: "Schedule data", value: loadError || accountsError ? `Needs retry: ${loadError ?? accountsError}` : loaded ? "Loaded" : "Loading…" },
      { label: "Clips in this run", value: String(readyClips.length) },
      { label: "Unscheduled clips", value: String(unscheduledCount) },
      { label: "Failed captions", value: String(failedCaptionClips.length) },
      {
        label: "YouTube quota",
        value: overview ? `${overview.quota.uploadsUsed}/${overview.quota.budgetUploads} uploads` : "—",
      },
      { label: "Publishing", value: overview ? (overview.enabled ? "On" : "Off") : "—" },
      { label: "Shorts a day", value: shortsPerDay ? String(shortsPerDay) : "—" },
      { label: "Failed posts", value: String(failedLegs.length) },
    ],
    setField: (id, value) => {
      if (id === "runPlatform") {
        if (typeof value !== "string" || !(value in PLATFORM_TARGET_LABELS)) return false;
        onRunDefaultsChange({ ...runDefaults, platform: value as PlatformTarget });
        return true;
      }
      if (id === "runHashtags") {
        if (typeof value !== "string") return false;
        const hashtags = value.split(/\s+/).filter(Boolean);
        onRunDefaultsChange({ ...runDefaults, hashtags });
        return true;
      }
      if (id === "scheduleOffsetDays") {
        const next = Number(value);
        if (!Number.isFinite(next)) return false;
        setSlotOffsetDays(next);
        return true;
      }
      if (id === "activeJobId") {
        if (typeof value !== "string" || !jobsWithClips.some((job) => job.id === value)) return false;
        setActiveJobId(value);
        return true;
      }
      return false;
    },
    click: (id) => {
      if (id === "retry-load") {
        if (refreshing || accountsRefreshing) return false;
        void refresh();
        void refreshAccounts();
        return true;
      }
      if (id === "autoAssign") {
        if (!loaded || bulkBusy || unscheduledCount === 0 || !publishingOn) return false;
        void handleAutoAssign();
        return true;
      }
      if (id === "captionsForAll") {
        if (bulkBusy) return false;
        handleCaptionsForAll();
        return true;
      }
      if (id === "retryCaptions") {
        if (bulkBusy || failedCaptionClips.length === 0) return false;
        handleRetryCaptions();
        return true;
      }
      if (id === "cancelPlacement") {
        if (!placingClip) return false;
        setPlacingKey(null);
        return true;
      }
      return false;
    },
  });

  return (
    // The header is a frozen pane and everything under it scrolls: the calendar
    // runs to months of days, and losing the channel and the quota meter on the
    // way down is how you end up scrolling back to check which one you are on.
    // Phones scroll the whole page instead (see `.app-frame` in globals.css).
    <div className="app-frame-pane">
      <PageHeader
        eyebrow="Step 3 · Schedule"
        title="Uploading Center"
        description="Book your finished clips onto the posting schedule — one button fills the next free slots, or drag a clip onto any slot yourself."
        actions={overview ? <div className="w-full max-w-sm"><QuotaMeter quota={overview.quota} /></div> : undefined}
      />
      <OAuthLandingBanner landing={oauthLanding} onDismiss={dismissOauthLanding} />
      {loadError ? <div className="mb-4"><WorkflowLoadNotice title="Your clips and posting schedule could not be refreshed" message={loadError} retained={loaded} retrying={refreshing} onRetry={() => void refresh()} /></div> : null}
      {accountsError ? <div className="mb-4"><WorkflowLoadNotice title="Your social accounts could not be refreshed" message={accountsError} retained={loaded} retrying={accountsRefreshing} onRetry={() => void refreshAccounts()} /></div> : null}

      {placingClip ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2.5">
          <CalendarClock className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <p className="min-w-0 flex-1 text-sm text-white">
            Scheduling{" "}
            <span className="font-semibold">“{placingClip.headline}”</span> —
            click any open slot on the calendar (or drag the card) and the
            upload is scheduled for that time.
          </p>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={() => setPlacingKey(null)}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="app-frame-scroll">
        {!loaded && (loadError || accountsError) ? null : !loaded ? (
          <Card className="flex items-center justify-center gap-2 py-16" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            <span className="text-sm text-[var(--muted-foreground)]">Loading your clips, accounts and schedule…</span>
          </Card>
        ) : (
          <>
            {!publishingOn ? <PostingOffBanner /> : null}
            {publisherLine ? <PublisherStatusLine line={publisherLine} /> : null}
            {failedLegs.length > 0 ? (
              <FailedStrip
                legs={failedLegs}
                counts={failedByPlatform}
                timezone={timezone}
                plan={retryPlan}
                postingOn={publishingOn}
                activePlatform={activePlatform}
                retrying={busy === "rearm"}
                onShow={jumpToFailure}
                onRetryConnection={() => void rearmConnectionFailures(retryPlan.targets)}
              />
            ) : null}
            <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(22rem,1fr)_minmax(0,2.3fr)]">
              <ClipQueue
                jobs={jobsWithClips}
                activeJob={activeJob}
                onSelectJob={setActiveJobId}
                clips={readyClips}
                tiktokAccountId={activeAccountIds.tiktok}
                slots={slots}
                draftFor={draftFor}
                onDraftChange={onDraftChange}
                onTitleCommit={onTitleCommit}
                isSlotTaken={isTargetSlotTaken}
                itemsForClip={itemsForClip}
                busy={busy}
                highlightedKey={placingKey}
                onSchedule={(clip) => void handleSchedule(clip)}
                onEditClip={editClip}
                onTailorCaption={(clip) => void onTailorCaption(clip)}
                onAutoAssign={() => void handleAutoAssign()}
                bookingSummary={bookingSummary}
                onDismissBookingSummary={dismissBookingSummary}
                runDefaults={runDefaults}
                onRunDefaultsChange={onRunDefaultsChange}
                onCaptionsForAll={handleCaptionsForAll}
                captionsMissing={captionsMissing}
                captionProgress={captionProgress}
                captionFailures={captionFailures}
                failedCaptionCount={failedCaptionClips.length}
                onRetryCaptions={handleRetryCaptions}
                targetLabels={targetLabels}
                shortsCap={shortsCap}
                tomorrowKey={tomorrowKey}
                isSlotUnavailable={isSlotUnavailable}
                readOnlyReason={publishingOn ? undefined : "Posting is off - turn it on in Settings to book clips."}
                timeZone={timezone}
                aiCopyAvailable={aiCopyFellBack ? false : overview?.aiCopyAvailable}
                onShowOnBoard={showBookedItem}
              />
              <div className="min-w-0">
                {/* Said once above the board, not only on the empty day it used
                    to appear on: this is why no slot is ever offered for today. */}
                <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                  Bookings start tomorrow so a batch never trips YouTube&apos;s daily limit. Use Publish now on a post
                  to send it today.
                </p>
                <Tabs tabs={tabs} paramKey="platform" />
                {overview ? (
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    Every scheduled post and channel video shows on its day above.
                    Suggested slots: weekdays {listTimes(overview.slotTimes ?? DEFAULT_SLOT_TIMES)}; weekends{" "}
                    {listTimes(overview.weekendSlotTimes ?? DEFAULT_WEEKEND_SLOT_TIMES)}. Times shown in{" "}
                    {zoneTimeLabel(overview.timezone)}.
                    {shortsPerDay ? (
                      <>
                        {" "}
                        Up to {shortsPerDay} short{shortsPerDay === 1 ? "" : "s"} a day - change this on{" "}
                        <Link href="/automations#cadence" className="text-[var(--accent)]! underline! underline-offset-2">
                          Automations
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        {" "}
                        <Link href="/automations#cadence" className="text-[var(--accent)]! underline! underline-offset-2">
                          Change the cadence
                        </Link>
                        .
                      </>
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <UploadSuccessDialog
        success={uploadSuccess}
        channelId={channel?.channelId ?? null}
        timezone={overview?.timezone}
        onClose={dismissUploadSuccess}
      />
    </div>
  );
}

/**
 * Confirmation shown the moment a drag-dropped (or Schedule-button) clip has
 * finished uploading to YouTube: a link straight to the video and a big
 * button into the channel's Content page in YouTube Studio.
 */
function listTimes(times: string[]): string {
  if (times.length < 2) return times.join("");
  return `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
}

function UploadSuccessDialog({
  success,
  channelId,
  timezone,
  onClose,
}: {
  success: UploadSuccess | null;
  channelId: string | null;
  timezone?: string;
  onClose: () => void;
}) {
  if (!success) return null;
  const scheduled = success.status === "scheduled";
  const goLive = dateTimeFormat("en-US", {
    ...(timezone ? { timeZone: timezone } : {}),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(success.publishAt));
  return (
    <Modal
      open
      title={
        scheduled ? "Uploaded — scheduled on YouTube" : "Published to YouTube"
      }
      description={
        scheduled
          ? `“${success.title}” is on your channel as a Short and goes live ${goLive}.`
          : `“${success.title}” is live on your channel as a Short.`
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="tone-success tone-edge tone-soft tone-text flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {scheduled
            ? "Nothing else to do — YouTube publishes it at the slot time on its own."
            : "The upload is done — no further steps needed."}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="h-11 flex-1"
            onClick={() => window.open(success.videoUrl, "_blank", "noopener")}
          >
            <Play className="mr-2 h-4 w-4" /> Watch the video
          </Button>
          <Button
            className="h-11 flex-1"
            onClick={() =>
              window.open(
                success.postId
                  ? studioVideoUrl(success.postId)
                  : studioContentUrl(channelId),
                "_blank",
                "noopener",
              )
            }
          >
            <ExternalLink className="mr-2 h-4 w-4" />{" "}
            {success.postId
              ? "Edit in YouTube Studio"
              : "Open YouTube Studio Content"}
          </Button>
        </div>
        {scheduled ? (
          <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            Scheduled videos show under Content → Scheduled in YouTube Studio
            until they go live.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Calendar paging for the schedule window: step back through past two-week
 * periods (as far as the channel's history reaches) and forward through future
 * ones, or jump straight back to the default window around today. The window is
 * arithmetic over the timezone and the offset, not a request, so a page turn
 * lands immediately and there is nothing to wait for.
 */
function SchedulePeriodNav({
  offsetDays,
  slots,
  onChange,
}: {
  offsetDays: number;
  slots: ScheduleSlot[];
  onChange: (offsetDays: number) => void;
}) {
  const first = slots[0];
  const last = slots[slots.length - 1];
  const atDefault = offsetDays === DEFAULT_SLOT_OFFSET_DAYS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        className="h-8 px-2.5"
        aria-label={`Previous ${SLOT_WINDOW_DAYS} days`}
        title={`Previous ${SLOT_WINDOW_DAYS} days`}
        onClick={() => onChange(offsetDays - SLOT_WINDOW_DAYS)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        className="h-8 px-2.5"
        aria-label={`Next ${SLOT_WINDOW_DAYS} days`}
        title={`Next ${SLOT_WINDOW_DAYS} days`}
        onClick={() => onChange(offsetDays + SLOT_WINDOW_DAYS)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <span className="ml-1 flex items-center gap-2 text-sm font-medium text-white">
        {first && last ? `${first.dateLabel} – ${last.dateLabel}` : ""}
      </span>
      {atDefault ? (
        <Badge className="border-[var(--border)] bg-white/5 text-[var(--muted-foreground)]">
          This period
        </Badge>
      ) : null}
      <span className="flex-1" />
      {!atDefault ? (
        <Button
          variant="ghost"
          className="h-8 px-3 text-xs"
          onClick={() => onChange(DEFAULT_SLOT_OFFSET_DAYS)}
        >
          <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Jump to today
        </Button>
      ) : null}
    </div>
  );
}

function connectUrl(accountId?: string) {
  return accountId
    ? `/api/auth/google?account=${encodeURIComponent(accountId)}`
    : "/api/auth/google";
}

function tiktokConnectUrl(accountId?: string) {
  return accountId
    ? `/api/auth/tiktok?account=${encodeURIComponent(accountId)}`
    : "/api/auth/tiktok";
}

function SettingsConnectionLink() {
  return (
    <Link href="/settings#accounts" className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--border)] bg-white/5 px-3 text-xs font-medium max-sm:h-10 text-white hover:bg-white/10">
      Account settings
    </Link>
  );
}

/**
 * The one sentence every "not connected" banner says. It is ONE element: a text
 * node and an inline chip placed straight into a `flex` paragraph become three
 * columns, which is how the Instagram banner broke into "...stay as | chip |
 * reminders meanwhile". The icon stays its own flex child beside this span.
 */
function ReminderSentence({ platform, extraAccount }: { platform: PlatformId; extraAccount?: boolean }) {
  return (
    <span className="min-w-0">
      Bookings for {extraAccount ? `this ${PLATFORM_LABELS[platform]} account` : PLATFORM_LABELS[platform]} are saved as
      reminders until it&apos;s connected - each shows{" "}
      <StatusChip status="manual" platform={platform} connected={false} className="align-middle" />.
    </span>
  );
}

function ConnectTiktokNotice({
  accountId,
  primary,
}: {
  accountId?: string;
  primary?: boolean;
}) {
  return (
    <div className="tone-warning tone-edge tone-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <p className="tone-warning tone-text flex items-start gap-2 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <ReminderSentence platform="tiktok" extraAccount={!primary} />
      </p>
      {primary ? <SettingsConnectionLink /> : (
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => (window.location.href = tiktokConnectUrl(accountId))}>
          Connect TikTok
        </Button>
      )}
    </div>
  );
}

function ReconnectYoutubeNotice({ accountId }: { accountId?: string }) {
  return (
    <div className="tone-warning tone-edge tone-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <p className="tone-warning tone-text flex items-center gap-2 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Uploads still work, but the current connection can&apos;t read your
        channel — reconnect to see the videos already scheduled on YouTube here.
      </p>
      <Button
        variant="secondary"
        className="h-8 px-3 text-xs"
        onClick={() => (window.location.href = connectUrl(accountId))}
      >
        Reconnect YouTube
      </Button>
    </div>
  );
}

function ConnectYoutubeNotice({ accountId, primary }: { accountId?: string; primary?: boolean }) {
  return (
    <div className="tone-warning tone-edge tone-soft flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <p className="tone-warning tone-text flex items-start gap-2 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <ReminderSentence platform="youtube" extraAccount={!primary} />
      </p>
      {primary ? <SettingsConnectionLink /> : (
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => (window.location.href = connectUrl(accountId))}>
          Connect YouTube
        </Button>
      )}
    </div>
  );
}

/**
 * Posting is switched off. The schedule, the accounts and the Connect buttons
 * stay on screen (the OAuth callbacks land here, and a second account can only
 * be added here); what stops is booking. YouTube and Facebook keep publishing
 * what they were already handed, which is the part that surprises.
 */
function PostingOffBanner() {
  return (
    <div
      role="status"
      className="tone-warning tone-edge tone-soft mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
    >
      <p className="tone-warning tone-text flex min-w-0 flex-1 items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Posting is off: nothing new can be booked and nothing goes out from here. Posts YouTube or Facebook already
          hold still go live.
        </span>
      </p>
      <Link
        href="/settings#publishing"
        className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--border)] bg-white/5 px-3 text-xs font-medium max-sm:h-10 text-white hover:bg-white/10"
      >
        Turn posting on in Settings
      </Link>
    </div>
  );
}

/** The one line about the publisher: a warning when it needs attention, muted when it is fine. */
function PublisherStatusLine({ line }: { line: NonNullable<ReturnType<typeof publisherBannerLine>> }) {
  const link = line.href ? (
    <Link href={line.href} className="ml-1.5 underline underline-offset-2">
      {line.linkLabel ?? "Open"}
    </Link>
  ) : null;
  if (line.tone === "muted") {
    return (
      <p className="mb-3 text-xs text-[var(--muted-foreground)]">
        {line.text}
        {link}
      </p>
    );
  }
  return (
    <div role="status" className="tone-warning tone-edge tone-soft mb-4 rounded-lg border px-3 py-2">
      <p className="tone-warning tone-text flex items-start gap-2 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {line.text}
          {link}
        </span>
      </p>
    </div>
  );
}

const FAILED_STRIP_ROWS = 4;

/**
 * Every failed post on every platform tab and account, in one place with a way
 * to each, and one button for the failures a reconnect fixes. Failures used to
 * be found by clicking through four tabs and a two-week window.
 */
function FailedStrip({
  legs,
  counts,
  timezone,
  plan,
  postingOn,
  activePlatform,
  retrying,
  onShow,
  onRetryConnection,
}: {
  legs: FailedLeg[];
  counts: Record<PlatformId, number>;
  timezone: string;
  /** What the bulk retry can do right now, per connected account. */
  plan: ConnectionRetryPlan;
  postingOn: boolean;
  /** The platform tab on screen: a failure on another one switches tabs. */
  activePlatform: PlatformId;
  retrying: boolean;
  onShow: (leg: FailedLeg) => void;
  onRetryConnection: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? legs : legs.slice(0, FAILED_STRIP_ROWS);
  const byPlatform = PLATFORM_TABS.filter(({ id }) => counts[id] > 0)
    .map(({ id }) => `${PLATFORM_LABELS[id]} ${counts[id]}`)
    .join(" · ");
  const hasConnectionFailures = plan.count > 0 || plan.needConnection.length > 0 || plan.tooOld > 0;
  const canRetry = postingOn && plan.count > 0;
  const help = retryConnectionHelp(plan);
  const when = (leg: FailedLeg) =>
    dateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(leg.item.publishAt));
  return (
    <section
      aria-label="Failed posts"
      className="tone-danger tone-edge tone-soft mb-4 space-y-2 rounded-lg border px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="tone-danger tone-text flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Failed ({legs.length})
        </h2>
        <span className="text-[11px] text-[var(--muted-foreground)]">{byPlatform}</span>
        <span className="flex-1" />
        {hasConnectionFailures ? (
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={onRetryConnection}
            disabled={retrying || !canRetry}
            title={
              canRetry
                ? "Puts these posts back in the queue for the accounts that are connected now. Posts more than a day past their slot stay failed, to retry one by one."
                : (help ?? undefined)
            }
          >
            {retrying ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {retryConnectionLabel(plan.count)}
          </Button>
        ) : null}
      </div>
      {help ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted-foreground)]">
          <span>{help}</span>
          {plan.needConnection.length > 0 ? (
            <Link href="/settings#accounts" className="font-medium text-[var(--accent)] underline-offset-2 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
              Open Settings &rarr; Accounts
            </Link>
          ) : null}
        </p>
      ) : null}
      <ul className="space-y-1">
        {shown.map((leg) => (
          <li key={`${leg.item.id}:${leg.platform}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="shrink-0 font-medium text-white">{PLATFORM_LABELS[leg.platform]}</span>
            <span className="min-w-0 max-w-[16rem] truncate text-white" title={leg.item.title}>
              {leg.item.title}
            </span>
            <span className="shrink-0 text-[var(--muted-foreground)]">{when(leg)}</span>
            <span className="min-w-0 flex-1 basis-60 text-[var(--muted-foreground)]">{leg.headline}</span>
            <button
              type="button"
              onClick={() => onShow(leg)}
              className="shrink-0 font-medium text-[var(--accent)] underline-offset-2 hover:underline max-sm:min-h-10"
            >
              {leg.platform === activePlatform ? "Show on the board" : `Show on the ${PLATFORM_LABELS[leg.platform]} tab`}
            </button>
          </li>
        ))}
      </ul>
      {legs.length > FAILED_STRIP_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="text-[11px] font-medium text-[var(--muted-foreground)] underline-offset-2 hover:text-white hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${legs.length}`}
        </button>
      ) : null}
    </section>
  );
}

