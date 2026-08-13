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
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle, makeClipProject, makeTitleOverlay } from "@/lib/clipping/editor";
import { writeDraftProject } from "@/components/editor/drafts";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { AccountSwitcher } from "@/components/uploading-center/account-switcher";
import { ClipQueue } from "@/components/uploading-center/clip-queue";
import { clipsNeedingCaption, nameClips, planAutoAssign } from "@/components/uploading-center/bulk";
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
  PLATFORM_LABELS,
  SLOT_WINDOW_DAYS,
  copyPlatformFor,
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
import { slotOffsetForDateKey } from "@/lib/publisher/slotWindow";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import { localCalendarParts } from "@/lib/publisher/time";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

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
    overview,
    slots,
    slotOffsetDays,
    setSlotOffsetDays,
    channel,
    channelVideos,
    channelVideosBySlot,
    itemsByPlatform,
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
    schedule,
    uploadToSlot,
    autoAssign,
    publishNow,
    remove,
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
    const timer = setInterval(() => void refresh(), 60_000);
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
  const [drafts, setDrafts] = useState<Record<string, ClipDraft>>({});
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  const draftFor = useCallback(
    (clip: ReadyClip): ClipDraft => drafts[clip.key] ?? draftWithDefaults(clip, runDefaults),
    [drafts, runDefaults],
  );
  const putDraft = useCallback((clip: ReadyClip, draft: ClipDraft) => {
    setDrafts((current) => ({ ...current, [clip.key]: draft }));
    writeClipDraft(clip.key, draft, clip.headline);
  }, []);

  // Restore saved drafts for whichever run is on screen. Clips with nothing
  // saved are left out of the map on purpose, so they keep following the run
  // defaults as those change.
  useEffect(() => {
    if (readyClips.length === 0) return;
    queueMicrotask(() => {
      const stored = readClipDrafts();
      setDrafts((current) => {
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
  }, [readyClips, runDefaults]);

  // Changing the run defaults re-aims the cards already on screen, not just the
  // ones drawn next — dropped hashtags leave every title, new ones join it.
  const onRunDefaultsChange = useCallback(
    (next: RunDefaults) => {
      setRunDefaults(next);
      writeRunDefaults(next);
      const updated: Record<string, ClipDraft> = {};
      for (const clip of readyClips) {
        const existing = drafts[clip.key];
        if (!existing) continue;
        const redrafted = redraftWithDefaults(existing, runDefaults, next);
        updated[clip.key] = redrafted;
        writeClipDraft(clip.key, redrafted, clip.headline);
      }
      setDrafts((current) => ({ ...current, ...updated }));
    },
    [drafts, readyClips, runDefaults],
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
      putDraft(clip, { ...(draftsRef.current[clip.key] ?? draft), caption: result.caption });
      const label = draft.platform === "all" ? "all platforms" : draft.platform;
      if (result.bestTime) {
        toast.success(`Tailored for ${label}. Best time to post: ~${result.bestTime}.`);
      } else {
        toast.success(`Caption tailored for ${label}.`);
      }
    },
    [draftFor, putDraft, tailorCaption],
  );

  // Surface the OAuth redirect result exactly once.
  const searchParams = useSearchParams();
  const router = useRouter();
  const oauthToastShown = useRef(false);
  useEffect(() => {
    if (oauthToastShown.current) return;
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    if (connected === "tiktok") {
      oauthToastShown.current = true;
      toast.success(
        "TikTok connected — scheduled posts will publish automatically.",
      );
    } else if (connected === "youtube") {
      oauthToastShown.current = true;
      // A non-primary connection carries its account id — switch the YouTube
      // tab to that account so the fresh connection is what's on screen.
      const accountParam = searchParams.get("account");
      if (accountParam) setActiveAccount("youtube", accountParam);
      const recovered = Number(searchParams.get("recovered") ?? 0);
      toast.success(
        recovered > 0
          ? `YouTube reconnected — ${recovered} blocked upload${recovered === 1 ? "" : "s"} retried automatically.`
          : "YouTube connected — scheduled posts will upload automatically.",
      );
    } else if (connectError) {
      oauthToastShown.current = true;
      toast.error(`Connect failed: ${connectError}`);
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
    // No wait for the window to arrive: the grid is built from the offset, so
    // by the time this runs again the day being scrolled to is already drawn.
    const targetId = itemParam ? `queue-item-${itemParam}` : `agenda-day-${dateKey}`;
    const target = document.getElementById(targetId);
    if (!target) return;
    focusKeyRef.current = focusKey;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [
    dayParam,
    itemParam,
    itemsByPlatform,
    loaded,
    overview?.timezone,
    setActiveJobId,
    setSlotOffsetDays,
    slotOffsetDays
  ]);
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
      schedule(clip, { ...draftFor(clip), ...override }),
    [draftFor, schedule],
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

  const activeYoutubeAccount = activeAccountFor("youtube");

  // Read through the ref, not through `drafts`: the bulk actions below await
  // between clips, and each one has to see the captions the previous ones wrote.
  const latestDraftFor = useCallback(
    (clip: ReadyClip): ClipDraft => draftsRef.current[clip.key] ?? draftWithDefaults(clip, runDefaults),
    [runDefaults],
  );
  const isScheduled = useCallback(
    (clip: ReadyClip) => itemsForClip(clip).length > 0,
    [itemsForClip],
  );
  const captionsMissing = useMemo(
    () => clipsNeedingCaption({ clips: readyClips, draftFor, isScheduled }).length,
    [draftFor, isScheduled, readyClips],
  );

  // "AI captions for all": write a caption for every unscheduled clip that
  // hasn't got one, tailored to whatever platform each card targets.
  const fillCaptions = useCallback(
    async (clips: ReadyClip[]) => {
      const targets = clips.map((clip) => {
        const draft = latestDraftFor(clip);
        return { clip, platform: copyPlatformFor(draft.platform), title: draft.title };
      });
      return tailorCaptionsForAll(targets, (clip, caption) => {
        putDraft(clip, { ...latestDraftFor(clip), caption });
      });
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
    const missing = clipsNeedingCaption({ clips: readyClips, draftFor: latestDraftFor, isScheduled });
    const pass = missing.length > 0 ? await fillCaptions(missing) : null;
    // A clip whose caption failed is NOT scheduled. Posting it anyway would send
    // fallback copy under a success toast, which is indistinguishable from a
    // clip that was captioned properly — the retry button is the way back.
    const skipKeys = new Set((pass?.failed ?? []).map((failure) => failure.clip.key));
    const { assignments, unslotted, heldBack } = planAutoAssign({
      clips: readyClips,
      draftFor: latestDraftFor,
      isScheduled,
      slots,
      isTargetSlotTaken,
      skipKeys,
    });
    if (assignments.length === 0) {
      if (heldBack.length > 0) {
        toast.error(
          `Nothing scheduled — no AI caption for ${nameClips(heldBack.map((clip) => clip.headline))}. Retry the captions, or write them yourself.`,
        );
        return;
      }
      toast.info(
        unslotted > 0
          ? "No open slots left on the schedule."
          : "Every clip in this run is already scheduled.",
      );
      return;
    }
    if (unslotted > 0) {
      toast.info(
        `${unslotted} clip${unslotted === 1 ? "" : "s"} left unassigned — the schedule ran out of open slots.`,
      );
    }
    await autoAssign(assignments, heldBack);
  }, [
    autoAssign,
    fillCaptions,
    isScheduled,
    isTargetSlotTaken,
    latestDraftFor,
    readyClips,
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
      PLATFORM_TABS.map(({ id }) => [
        id,
        buildAgenda({
          slots,
          queueItems: itemsByPlatform.get(id) ?? [],
          channelVideos: id === "youtube" ? channelVideos : [],
          timeZone,
        }),
      ]),
    );
  }, [channelVideos, itemsByPlatform, overview?.timezone, slots]);

  const tabs = PLATFORM_TABS.map(({ id, icon }) => {
    const activeAccount = activeAccountFor(id);
    // Connection status follows the account the tab is showing, not the
    // platform as a whole — each account connects on its own.
    const configured = activeAccount?.connected ?? false;
    const days = agendas.get(id) ?? [];
    return {
      id,
      label: PLATFORM_LABELS[id],
      icon,
      content: (
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
            <ConnectYoutubeNotice accountId={activeAccount?.id} />
          ) : null}
          {id === "youtube" && configured && channel?.needsReconnect ? (
            <ReconnectYoutubeNotice accountId={activeAccount?.id} />
          ) : null}
          {id === "tiktok" && !configured && activeAccount?.primary ? (
            <ConnectTiktokNotice />
          ) : null}
          {id !== "youtube" &&
          !configured &&
          !(id === "tiktok" && activeAccount?.primary) ? (
            <p className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {PLATFORM_LABELS[id]} isn&apos;t connected yet — assignments save
              as <StatusChip status="manual" /> reminders. Automatic posting
              arrives with the unified posting API.
            </p>
          ) : null}
          {id === "tiktok" && configured ? (
            <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-3 py-2 text-xs text-emerald-200">
              {activeAccount?.tiktok
                ? `Connected as ${activeAccount.tiktok.title}. `
                : "TikTok connected. "}
              Posts publish at their slot time through the Content Posting API.
              Until TikTok audits the app they land on your profile as private
              (SELF_ONLY) — flip TIKTOK_AUDITED=true after approval.
            </p>
          ) : null}
          <SchedulePeriodNav
            offsetDays={slotOffsetDays}
            slots={slots}
            onChange={setSlotOffsetDays}
          />
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
            onPublishNow={(item) => void publishNow(item)}
            onRemove={(item) => void remove(item)}
            onRename={(item, title) => void renameQueueItem(item, title)}
            busy={busy}
            highlightedItemId={itemParam}
          />
          {id === "youtube" && channel?.error ? (
            <p
              className="truncate text-[11px] text-[var(--muted-foreground)]"
              title={channel.error}
            >
              Couldn&apos;t refresh the YouTube schedule — showing the last
              known state.
            </p>
          ) : null}
        </div>
      ),
    };
  });

  return (
    // The header is a frozen pane and everything under it scrolls: the calendar
    // runs to months of days, and losing the channel and the quota meter on the
    // way down is how you end up scrolling back to check which one you are on.
    <div className="app-frame-pane">
      <PageHeader
        eyebrow="Step 3 · Schedule"
        title="Uploading Center"
        description="Book your finished clips onto the posting schedule — one button fills the next free slots, or drag a clip onto any slot yourself."
        actions={
          <div className="flex w-full max-w-sm flex-col gap-2">
            {activeYoutubeAccount?.connected ? (
              <Badge className="self-start border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                {activeYoutubeAccount.youtube?.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
                  <img
                    src={activeYoutubeAccount.youtube.thumbnail}
                    alt=""
                    className="mr-1.5 h-4 w-4 rounded-full"
                  />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                {activeYoutubeAccount.youtube
                  ? `Connected as ${activeYoutubeAccount.youtube.title}`
                  : "YouTube connected"}
              </Badge>
            ) : (
              <Button
                onClick={() =>
                  (window.location.href = connectUrl(activeYoutubeAccount?.id))
                }
                className="self-start"
              >
                <Youtube className="mr-2 h-4 w-4" /> Connect YouTube
              </Button>
            )}
            {overview ? <QuotaMeter quota={overview.quota} /> : null}
          </div>
        }
      />

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
        {!loaded ? (
          <Card className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </Card>
        ) : overview && !overview.enabled ? (
          <Card className="space-y-2 border-amber-400/25">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
              <AlertTriangle className="h-4 w-4" /> Publishing is switched off
            </p>
            <p className="text-sm text-[var(--muted-foreground)]">
              Nothing is scheduled or posted until you turn it back on.{" "}
              <Link href="/settings" className="underline">
                Open Settings
              </Link>
            </p>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 xl:grid-cols-[minmax(22rem,1fr)_minmax(0,2.3fr)]">
              <ClipQueue
                jobs={jobsWithClips}
                activeJob={activeJob}
                onSelectJob={setActiveJobId}
                clips={readyClips}
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
                runDefaults={runDefaults}
                onRunDefaultsChange={onRunDefaultsChange}
                onCaptionsForAll={handleCaptionsForAll}
                captionsMissing={captionsMissing}
                captionProgress={captionProgress}
                captionFailures={captionFailures}
                failedCaptionCount={failedCaptionClips.length}
                onRetryCaptions={handleRetryCaptions}
              />
              <div className="min-w-0">
                <Tabs tabs={tabs} paramKey="platform" />
                {overview ? (
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    Every scheduled post and channel video shows on its day above.
                    Suggested slots: weekdays 07:30, 12:30 and 19:30; weekends
                    10:00, 13:00 and 19:00 ({overview.timezone}); stored in UTC.
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
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-3 py-2 text-xs text-emerald-200">
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

function ConnectTiktokNotice() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2">
      <p className="flex items-center gap-2 text-xs text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        TikTok isn&apos;t connected — new assignments save as manual reminders
        instead of posting. Connecting needs TIKTOK_CLIENT_KEY and
        TIKTOK_CLIENT_SECRET in .env first.
      </p>
      <Button
        variant="secondary"
        className="h-8 px-3 text-xs"
        onClick={() => (window.location.href = "/api/auth/tiktok")}
      >
        Connect TikTok
      </Button>
    </div>
  );
}

function ReconnectYoutubeNotice({ accountId }: { accountId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2">
      <p className="flex items-center gap-2 text-xs text-amber-200">
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

function ConnectYoutubeNotice({ accountId }: { accountId?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2">
      <p className="flex items-center gap-2 text-xs text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        This YouTube account isn&apos;t connected — new assignments save as
        manual reminders instead of uploading.
      </p>
      <Button
        variant="secondary"
        className="h-8 px-3 text-xs"
        onClick={() => (window.location.href = connectUrl(accountId))}
      >
        Connect YouTube
      </Button>
    </div>
  );
}
