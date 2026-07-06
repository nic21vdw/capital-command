"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  Facebook,
  Instagram,
  Loader2,
  Music2,
  Play,
  Youtube
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { ClipQueue } from "@/components/uploading-center/clip-queue";
import { QuotaMeter } from "@/components/uploading-center/quota-meter";
import { ScheduleBoard } from "@/components/uploading-center/schedule-board";
import { StatusChip } from "@/components/uploading-center/status-chip";
import {
  PLATFORM_LABELS,
  SLOT_WINDOW_DAYS,
  remoteUrlFor,
  studioContentUrl,
  studioVideoUrl,
  useUploadingCenter,
  type ClipDraft,
  type ReadyClip,
  type UploadSuccess
} from "@/components/uploading-center/use-uploading-center";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

const PLATFORM_TABS: Array<{ id: PlatformId; icon: typeof Youtube }> = [
  { id: "youtube", icon: Youtube },
  { id: "tiktok", icon: Music2 },
  { id: "instagram", icon: Instagram },
  { id: "facebook", icon: Facebook }
];

export function UploadingCenterPage() {
  const {
    loaded,
    overview,
    slotOffsetDays,
    setSlotOffsetDays,
    slotWindowLoading,
    channel,
    channelVideosBySlot,
    channelDayMarkers,
    channelVideosOutsideWindow,
    queueItems,
    jobsWithClips,
    activeJob,
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
    schedule,
    uploadToSlot,
    autoAssign,
    publishNow,
    remove,
    refresh
  } = useUploadingCenter();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The 60-second poll doubles as the TikTok/Instagram manual-reminder tick
  // (YouTube self-publishes); it's a no-op when nothing changed.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // One draft (title/caption/target/slot) per clip card, kept up here so a
  // drag-drop onto the board uses whatever was typed on the card. The title
  // itself is persisted to the backend clip on commit (blur/Enter), so it
  // survives navigating away — the draft only carries in-progress typing.
  const [drafts, setDrafts] = useState<Record<string, ClipDraft>>({});
  const draftFor = useCallback(
    (clip: ReadyClip): ClipDraft =>
      drafts[clip.key] ?? { title: clip.headline.slice(0, 100), caption: "", platform: "youtube", slotUtc: "" },
    [drafts]
  );
  const onDraftChange = useCallback((clip: ReadyClip, draft: ClipDraft) => {
    setDrafts((current) => ({ ...current, [clip.key]: draft }));
  }, []);
  const onTitleCommit = useCallback(
    (clip: ReadyClip) => {
      const draft = drafts[clip.key];
      if (!draft || draft.title.trim() === clip.headline) return;
      void renameClip(clip, draft.title);
    },
    [drafts, renameClip]
  );

  // Surface the OAuth redirect result exactly once.
  const searchParams = useSearchParams();
  const router = useRouter();
  const oauthToastShown = useRef(false);
  useEffect(() => {
    if (oauthToastShown.current) return;
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    if (connected === "youtube") {
      oauthToastShown.current = true;
      toast.success("YouTube connected — scheduled posts will upload automatically.");
    } else if (connectError) {
      oauthToastShown.current = true;
      toast.error(`YouTube connect failed: ${connectError}`);
    }
  }, [searchParams]);

  const itemAtSlot = useCallback(
    (platform: PlatformId, slotUtc: string) => itemsByPlatformSlot.get(platform)?.get(slotUtc),
    [itemsByPlatformSlot]
  );
  // A slot is taken by a queue item or — on YouTube — by a video already
  // scheduled/published on the channel itself at (or within a few minutes
  // of) that time, whether it was uploaded here or by hand in Studio.
  const channelVideoAtSlot = useCallback(
    (slotUtc: string) => channelVideosBySlot.get(slotUtc),
    [channelVideosBySlot]
  );
  const isSlotTaken = useCallback(
    (platform: PlatformId, slotUtc: string) =>
      Boolean(itemAtSlot(platform, slotUtc)) || (platform === "youtube" && channelVideosBySlot.has(slotUtc)),
    [itemAtSlot, channelVideosBySlot]
  );

  // Placement mode: the editor's Schedule Short button lands here with
  // ?scheduleJob=…&scheduleClip=…; that clip is pre-selected and every open
  // slot becomes a one-click target (dragging still works too).
  const [placingKey, setPlacingKey] = useState<string | null>(null);
  const placementConsumed = useRef(false);
  const scheduleJobParam = searchParams.get("scheduleJob");
  const scheduleClipParam = searchParams.get("scheduleClip");
  useEffect(() => {
    if (placementConsumed.current || !loaded || !scheduleJobParam || !scheduleClipParam) return;
    let cancelled = false;
    // Deferred so the state updates land after the render pass, not inside it.
    queueMicrotask(() => {
      if (cancelled || placementConsumed.current) return;
      setActiveJobId(scheduleJobParam);
      // The clip is matched by any file it was ever postable as, so the param
      // can be the editor's source file while the card shows the edited render.
      const clip = readyClips.find(
        (candidate) => candidate.jobId === scheduleJobParam && candidate.allFiles.includes(scheduleClipParam)
      );
      if (!clip) return; // readyClips still switching to that job — retry on the next render
      placementConsumed.current = true;
      setPlacingKey(clip.key);
      router.replace("/uploading-center");
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, readyClips, router, scheduleClipParam, scheduleJobParam, setActiveJobId]);
  const placingClip = useMemo(
    () => (placingKey ? (readyClips.find((clip) => clip.key === placingKey) ?? null) : null),
    [placingKey, readyClips]
  );

  const handleSchedule = useCallback(
    (clip: ReadyClip, override?: Partial<ClipDraft>) => schedule(clip, { ...draftFor(clip), ...override }),
    [draftFor, schedule]
  );
  const handleDrop = useCallback(
    (platform: PlatformId, slotUtc: string, clipKey: string) => {
      const clip = readyClips.find((candidate) => candidate.key === clipKey);
      if (!clip) return;
      void handleSchedule(clip, { platform, slotUtc }).then((ok) => {
        if (ok && clipKey === placingKey) setPlacingKey(null);
      });
    },
    [handleSchedule, placingKey, readyClips]
  );
  const handleSelectSlot = useCallback(
    (platform: PlatformId, slotUtc: string) => {
      if (!placingClip || busy) return;
      void handleSchedule(placingClip, { platform, slotUtc }).then((ok) => {
        if (ok) setPlacingKey(null);
      });
    },
    [busy, handleSchedule, placingClip]
  );

  const slots = useMemo(() => overview?.slots ?? [], [overview]);
  const slotUtcSet = useMemo(() => new Set(slots.map((slot) => slot.utc)), [slots]);

  // Auto Assign: pair every not-yet-scheduled clip in this run with the next
  // open slot for its card's platform (slots are ordered soonest-first).
  // Slots consumed within the batch are tracked locally so two clips never
  // land on the same time.
  const handleAutoAssign = useCallback(() => {
    const consumed = new Set<string>();
    const assignments: Array<{ clip: ReadyClip; draft: ClipDraft }> = [];
    let unslotted = 0;
    for (const clip of readyClips) {
      if (itemsForClip(clip).length > 0) continue;
      const draft = draftFor(clip);
      const slot = slots.find(
        (candidate) =>
          !candidate.past &&
          !consumed.has(`${draft.platform}:${candidate.utc}`) &&
          !isSlotTaken(draft.platform, candidate.utc)
      );
      if (!slot) {
        unslotted += 1;
        continue;
      }
      consumed.add(`${draft.platform}:${slot.utc}`);
      assignments.push({ clip, draft: { ...draft, slotUtc: slot.utc } });
    }
    if (assignments.length === 0) {
      toast.info(unslotted > 0 ? "No open slots left on the schedule." : "Every clip in this run is already scheduled.");
      return;
    }
    if (unslotted > 0) {
      toast.info(`${unslotted} clip${unslotted === 1 ? "" : "s"} left unassigned — the schedule ran out of open slots.`);
    }
    void autoAssign(assignments);
  }, [autoAssign, draftFor, isSlotTaken, itemsForClip, readyClips, slots]);

  const tabs = PLATFORM_TABS.map(({ id, icon }) => {
    const configured = overview?.platforms[id]?.configured ?? false;
    const offGrid = queueItems.filter(
      (item) => item.platforms[id] && !slotUtcSet.has(new Date(item.publishAt).toISOString())
    );
    // Channel videos on a day the grid shows render on the grid itself (in a
    // slot cell or as a day marker); the rest are listed below the board with
    // their exact upload/go-live time.
    const offSlotVideos = id === "youtube" ? channelVideosOutsideWindow : [];
    return {
      id,
      label: PLATFORM_LABELS[id],
      icon,
      content: (
        <div className="space-y-4">
          {id === "youtube" && configured ? (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => window.open(studioContentUrl(channel?.channelId), "_blank", "noopener")}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open YouTube Studio Content
              </Button>
            </div>
          ) : null}
          {id === "youtube" && !configured ? (
            <ConnectYoutubeNotice />
          ) : null}
          {id === "youtube" && configured && channel?.needsReconnect ? (
            <ReconnectYoutubeNotice />
          ) : null}
          {id !== "youtube" && !configured ? (
            <p className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {PLATFORM_LABELS[id]} isn&apos;t connected yet — assignments save as <StatusChip status="manual" /> reminders.
              Automatic posting arrives with the unified posting API.
            </p>
          ) : null}
          <SchedulePeriodNav
            offsetDays={slotOffsetDays}
            slots={slots}
            loading={slotWindowLoading}
            onChange={setSlotOffsetDays}
          />
          <ScheduleBoard
            platform={id}
            slots={slots}
            itemAtSlot={itemAtSlot}
            thumbnailForItem={thumbnailForItem}
            channelVideoAtSlot={id === "youtube" ? channelVideoAtSlot : undefined}
            channelDayMarkers={id === "youtube" ? channelDayMarkers : undefined}
            onDropClip={(slotUtc, clipKey) => handleDrop(id, slotUtc, clipKey)}
            onUploadVideo={(slotUtc, file) => void uploadToSlot(file, { platform: id, slotUtc })}
            onSelectSlot={placingClip ? (slotUtc) => handleSelectSlot(id, slotUtc) : undefined}
            onPublishNow={(item) => void publishNow(item)}
            onRemove={(item) => void remove(item)}
            onRename={(item, title) => void renameQueueItem(item, title)}
            busy={busy}
          />
          {offGrid.length > 0 ? (
            <OffGridList platform={id} items={offGrid} onPublishNow={publishNow} onRemove={remove} busy={busy} />
          ) : null}
          {offSlotVideos.length > 0 ? <ChannelVideoList videos={offSlotVideos} timezone={overview?.timezone} /> : null}
          {id === "youtube" && channel?.error ? (
            <p className="truncate text-[11px] text-[var(--muted-foreground)]" title={channel.error}>
              Couldn&apos;t refresh the YouTube schedule — showing the last known state.
            </p>
          ) : null}
        </div>
      )
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="YouTube tools"
        title="Uploading Center"
        description="Assign finished clips to a platform and a slot. Dropping a clip — or a video file straight from your computer — on a slot uploads it to YouTube immediately as a scheduled Short (landscape clips are re-rendered vertical automatically) — it appears under Scheduled in YouTube Studio and goes live at the slot time on its own; TikTok and Instagram queue as manual reminders until a unified posting API is connected."
        actions={
          <div className="flex w-full max-w-sm flex-col gap-2">
            {overview?.platforms.youtube.configured ? (
              <Badge className="self-start border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                {overview.platforms.youtube.account?.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
                  <img
                    src={overview.platforms.youtube.account.thumbnail}
                    alt=""
                    className="mr-1.5 h-4 w-4 rounded-full"
                  />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                {overview.platforms.youtube.account
                  ? `Connected as ${overview.platforms.youtube.account.title}`
                  : "YouTube connected"}
              </Badge>
            ) : (
              <Button onClick={() => (window.location.href = "/api/auth/google")} className="self-start">
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
            Scheduling <span className="font-semibold">“{placingClip.headline}”</span> — click any open slot on the
            calendar (or drag the card) and the upload is scheduled for that time.
          </p>
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setPlacingKey(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

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
            Add <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">PUBLISH_ENABLED=true</code> to your{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">.env</code> and restart the app to use the
            Uploading Center.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(26rem,2fr)_minmax(0,3fr)]">
          <ClipQueue
            jobs={jobsWithClips}
            activeJob={activeJob}
            onSelectJob={setActiveJobId}
            clips={readyClips}
            slots={slots}
            draftFor={draftFor}
            onDraftChange={onDraftChange}
            onTitleCommit={onTitleCommit}
            isSlotTaken={isSlotTaken}
            itemsForClip={itemsForClip}
            busy={busy}
            highlightedKey={placingKey}
            onSchedule={(clip) => void handleSchedule(clip)}
            onAutoAssign={handleAutoAssign}
          />
          <div className="min-w-0">
            <Tabs tabs={tabs} paramKey="platform" />
            {overview ? (
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                Weekday slots at 07:30, 12:30 and 19:30; weekend slots at 10:00, 13:00 and 19:00 ({overview.timezone});
                stored in UTC.
              </p>
            ) : null}
          </div>
        </div>
      )}

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
  onClose
}: {
  success: UploadSuccess | null;
  channelId: string | null;
  timezone?: string;
  onClose: () => void;
}) {
  if (!success) return null;
  const scheduled = success.status === "scheduled";
  const goLive = new Intl.DateTimeFormat("en-US", {
    ...(timezone ? { timeZone: timezone } : {}),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(success.publishAt));
  return (
    <Modal
      open
      title={scheduled ? "Uploaded — scheduled on YouTube" : "Published to YouTube"}
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
                success.postId ? studioVideoUrl(success.postId) : studioContentUrl(channelId),
                "_blank",
                "noopener"
              )
            }
          >
            <ExternalLink className="mr-2 h-4 w-4" />{" "}
            {success.postId ? "Edit in YouTube Studio" : "Open YouTube Studio Content"}
          </Button>
        </div>
        {scheduled ? (
          <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            Scheduled videos show under Content → Scheduled in YouTube Studio until they go live.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Calendar-style paging for the schedule grid: step forward through future
 * two-week periods (as far ahead as you like), step back toward today, and
 * jump straight back to the current period. Going before today is pointless,
 * so the back arrow stops at the current window. While a new window is being
 * fetched the buttons disable and the label shows a spinner — the previous
 * window's slots stay on screen until the new ones arrive.
 */
function SchedulePeriodNav({
  offsetDays,
  slots,
  loading,
  onChange
}: {
  offsetDays: number;
  slots: ScheduleSlot[];
  loading: boolean;
  onChange: (offsetDays: number) => void;
}) {
  const first = slots[0];
  const last = slots[slots.length - 1];
  const atCurrentPeriod = offsetDays === 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        className="h-8 px-2.5"
        aria-label={`Previous ${SLOT_WINDOW_DAYS} days`}
        title={atCurrentPeriod ? "Already on the current period" : `Previous ${SLOT_WINDOW_DAYS} days`}
        disabled={atCurrentPeriod || loading}
        onClick={() => onChange(Math.max(0, offsetDays - SLOT_WINDOW_DAYS))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        className="h-8 px-2.5"
        aria-label={`Next ${SLOT_WINDOW_DAYS} days`}
        title={`Next ${SLOT_WINDOW_DAYS} days`}
        disabled={loading}
        onClick={() => onChange(offsetDays + SLOT_WINDOW_DAYS)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <span className="ml-1 flex items-center gap-2 text-sm font-medium text-white">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" /> : null}
        {first && last ? `${first.dateLabel} – ${last.dateLabel}` : ""}
      </span>
      {atCurrentPeriod && !loading ? (
        <Badge className="border-[var(--border)] bg-white/5 text-[var(--muted-foreground)]">Current period</Badge>
      ) : null}
      <span className="flex-1" />
      {!atCurrentPeriod ? (
        <Button variant="ghost" className="h-8 px-3 text-xs" disabled={loading} onClick={() => onChange(0)}>
          <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Back to current period
        </Button>
      ) : null}
    </div>
  );
}

function ReconnectYoutubeNotice() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2">
      <p className="flex items-center gap-2 text-xs text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Uploads still work, but the current connection can&apos;t read your channel — reconnect to see the videos
        already scheduled on YouTube here.
      </p>
      <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => (window.location.href = "/api/auth/google")}>
        Reconnect YouTube
      </Button>
    </div>
  );
}

function ConnectYoutubeNotice() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2">
      <p className="flex items-center gap-2 text-xs text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        YouTube isn&apos;t connected — new assignments save as manual reminders instead of uploading.
      </p>
      <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => (window.location.href = "/api/auth/google")}>
        Connect YouTube
      </Button>
    </div>
  );
}

/**
 * Videos already on the YouTube channel that fall outside the visible grid
 * window (in-window videos render on the grid itself, in a slot cell or as a
 * day marker): "Scheduled to go live …" for upcoming uploads, "Uploaded …"
 * for recently published ones. Read-only — they're managed in YouTube Studio.
 */
function ChannelVideoList({ videos, timezone }: { videos: ChannelVideo[]; timezone?: string }) {
  const formatTime = (utc: string) =>
    new Intl.DateTimeFormat("en-US", {
      ...(timezone ? { timeZone: timezone } : {}),
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(utc));
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        Also on your YouTube channel
      </p>
      {videos.map((video) => (
        <div
          key={video.videoId}
          className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs"
          title={video.title}
        >
          <StatusChip status={video.status} />
          <span className="truncate font-medium text-white">{video.title}</span>
          <span className="whitespace-nowrap text-[var(--muted-foreground)]">
            {video.status === "scheduled"
              ? `Scheduled to go live ${formatTime(video.publishAtUtc)}`
              : `Uploaded ${formatTime(video.publishAtUtc)}`}
          </span>
          <span className="flex-1" />
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer"
            aria-label="View the video"
            title="View the video"
            className="text-[var(--accent)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a
            href={studioVideoUrl(video.videoId)}
            target="_blank"
            rel="noreferrer"
            aria-label="Edit in YouTube Studio"
            title="Edit in YouTube Studio (title, description…)"
            className="text-[var(--accent)]"
          >
            <Clapperboard className="h-3.5 w-3.5" />
          </a>
        </div>
      ))}
    </div>
  );
}

/** Posts for this platform whose time doesn't line up with a grid slot. */
function OffGridList({
  platform,
  items,
  onPublishNow,
  onRemove,
  busy
}: {
  platform: PlatformId;
  items: QueueItem[];
  onPublishNow: (item: QueueItem) => Promise<void>;
  onRemove: (item: QueueItem) => Promise<void>;
  busy: string | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        Other scheduled posts
      </p>
      {items.map((item) => {
        const state = item.platforms[platform] as PlatformState;
        const url = remoteUrlFor(platform, state.postId);
        const working = busy === `publish:${item.id}` || busy === `remove:${item.id}`;
        return (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs"
            title={state.note ?? state.error ?? undefined}
          >
            <StatusChip status={state.status} />
            <span className="truncate font-medium text-white">{item.title}</span>
            <span className="text-[var(--muted-foreground)]">{new Date(item.publishAt).toLocaleString()}</span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label="View the video"
                title="View the video"
                className="text-[var(--accent)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            {platform === "youtube" && state.postId ? (
              <a
                href={studioVideoUrl(state.postId)}
                target="_blank"
                rel="noreferrer"
                aria-label="Edit in YouTube Studio"
                title="Edit in YouTube Studio (title, description…)"
                className="text-[var(--accent)]"
              >
                <Clapperboard className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <span className="flex-1" />
            {working ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
            ) : (
              <>
                {state.status === "pending" || state.status === "uploaded" || state.status === "failed" ? (
                  <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void onPublishNow(item)}>
                    Publish now
                  </Button>
                ) : null}
                <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void onRemove(item)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
