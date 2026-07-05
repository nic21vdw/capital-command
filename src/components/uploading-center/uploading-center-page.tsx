"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, Instagram, Loader2, Music2, Youtube } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { ClipQueue } from "@/components/uploading-center/clip-queue";
import { QuotaMeter } from "@/components/uploading-center/quota-meter";
import { ScheduleBoard } from "@/components/uploading-center/schedule-board";
import { StatusChip } from "@/components/uploading-center/status-chip";
import {
  PLATFORM_LABELS,
  remoteUrlFor,
  useUploadingCenter,
  type ClipDraft,
  type ReadyClip
} from "@/components/uploading-center/use-uploading-center";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

const PLATFORM_TABS: Array<{ id: PlatformId; icon: typeof Youtube }> = [
  { id: "youtube", icon: Youtube },
  { id: "tiktok", icon: Music2 },
  { id: "instagram", icon: Instagram }
];

export function UploadingCenterPage() {
  const {
    loaded,
    overview,
    queueItems,
    jobsWithClips,
    activeJob,
    setActiveJobId,
    readyClips,
    itemsForClip,
    itemsByPlatformSlot,
    thumbnailForItem,
    busy,
    renameClip,
    schedule,
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
  const isSlotTaken = useCallback(
    (platform: PlatformId, slotUtc: string) => Boolean(itemAtSlot(platform, slotUtc)),
    [itemAtSlot]
  );

  const handleSchedule = useCallback(
    (clip: ReadyClip, override?: Partial<ClipDraft>) => {
      void schedule(clip, { ...draftFor(clip), ...override });
    },
    [draftFor, schedule]
  );
  const handleDrop = useCallback(
    (platform: PlatformId, slotUtc: string, clipKey: string) => {
      const clip = readyClips.find((candidate) => candidate.key === clipKey);
      if (!clip) return;
      handleSchedule(clip, { platform, slotUtc });
    },
    [handleSchedule, readyClips]
  );

  const slots = useMemo(() => overview?.slots ?? [], [overview]);
  const slotUtcSet = useMemo(() => new Set(slots.map((slot) => slot.utc)), [slots]);

  const tabs = PLATFORM_TABS.map(({ id, icon }) => {
    const configured = overview?.platforms[id]?.configured ?? false;
    const offGrid = queueItems.filter(
      (item) => item.platforms[id] && !slotUtcSet.has(new Date(item.publishAt).toISOString())
    );
    return {
      id,
      label: PLATFORM_LABELS[id],
      icon,
      content: (
        <div className="space-y-4">
          {id === "youtube" && !configured ? (
            <ConnectYoutubeNotice />
          ) : null}
          {id !== "youtube" && !configured ? (
            <p className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {PLATFORM_LABELS[id]} isn&apos;t connected yet — assignments save as <StatusChip status="manual" /> reminders.
              Automatic posting arrives with the unified posting API.
            </p>
          ) : null}
          <ScheduleBoard
            platform={id}
            slots={slots}
            itemAtSlot={itemAtSlot}
            thumbnailForItem={thumbnailForItem}
            onDropClip={(slotUtc, clipKey) => handleDrop(id, slotUtc, clipKey)}
            onPublishNow={(item) => void publishNow(item)}
            onRemove={(item) => void remove(item)}
            busy={busy}
          />
          {offGrid.length > 0 ? (
            <OffGridList platform={id} items={offGrid} onPublishNow={publishNow} onRemove={remove} busy={busy} />
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
        description="Assign finished clips to a platform and a slot. YouTube uploads immediately as a scheduled video — it appears under Scheduled in YouTube Studio and goes live at the slot time on its own; TikTok and Instagram queue as manual reminders until a unified posting API is connected."
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
            onSchedule={(clip) => handleSchedule(clip)}
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
              <a href={url} target="_blank" rel="noreferrer" className="text-[var(--accent)]">
                <ExternalLink className="h-3.5 w-3.5" />
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
