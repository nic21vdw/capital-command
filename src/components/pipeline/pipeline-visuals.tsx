"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, AtSign, Loader2, Play, Podcast, Sparkles, UploadCloud, type LucideIcon } from "lucide-react";
import { STAGE_ICONS, STAGE_ORDER, STAGE_TITLES, StatusChip, NODE_STYLES } from "@/components/pipeline/stage-meta";
import { cn } from "@/lib/utils";
import type {
  PipelineRun,
  PipelineRunOverview,
  PipelineStage,
  PipelineStageKey,
  PipelineStageStatus
} from "@/lib/pipeline/types";

type Stages = Record<PipelineStageKey, PipelineStage>;

export function Thumb({
  src,
  retryKey,
  fallback,
  className
}: {
  src?: string;
  retryKey?: string;
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${src ?? ""}|${retryKey ?? ""}`;
  if (!src || failed === key) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(key)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

function formatDuration(totalSec: number): string {
  const seconds = Math.max(0, Math.round(totalSec));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function Fill({ children }: { children?: ReactNode }) {
  return <div className="pv-fill flex h-full w-full items-center justify-center">{children}</div>;
}

function LongformArt({ poster, retryKey, ticks }: { poster?: string; retryKey: string; ticks: number }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--border)]">
      <Thumb src={poster} retryKey={retryKey} fallback={<Fill />} />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-[#ffffff] backdrop-blur-sm">
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </span>
      </span>
      <span className="absolute inset-x-2 bottom-1.5 flex gap-0.5">
        {Array.from({ length: Math.max(ticks, 5) }, (_, index) => (
          <span key={index} className="h-[3px] flex-1 rounded-full bg-[#ffffff]/45" />
        ))}
      </span>
    </div>
  );
}

function ShortsArt({ clips, retryKey }: { clips: string[]; retryKey: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-1.5">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="relative aspect-[9/16] h-[92%] overflow-hidden rounded-md border border-[var(--border-strong)] shadow-[var(--shadow)]"
          style={{ transform: `rotate(${(index - 1) * 5}deg) translateY(${index === 1 ? 0 : 3}px)` }}
        >
          <Thumb
            src={clips[index]}
            retryKey={retryKey}
            fallback={
              <Fill>
                <span className="absolute inset-x-1.5 bottom-2 space-y-1">
                  <span className="block h-1 rounded-full bg-[var(--foreground)]/25" />
                  <span className="block h-1 w-2/3 rounded-full bg-[var(--foreground)]/15" />
                </span>
              </Fill>
            }
          />
        </div>
      ))}
    </div>
  );
}

const WAVE = [38, 62, 46, 88, 54, 100, 70, 42, 78, 58, 92, 50, 34, 66, 44];

function PodcastArt({ live, done }: { live: boolean; done: boolean }) {
  return (
    <div className="flex h-full items-center justify-center gap-3">
      <span className="pv-fill flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[var(--accent)]">
        <Podcast className="h-5 w-5" />
      </span>
      <span className="flex h-10 items-center gap-[3px]">
        {WAVE.map((height, index) => (
          <span
            key={index}
            className={cn("pv-bar w-[3px] rounded-full bg-[var(--accent)]", live && "pv-bar-live")}
            style={{
              height: `${height}%`,
              opacity: live || done ? 1 : 0.4,
              animationDelay: `${index * 70}ms`
            }}
          />
        ))}
      </span>
    </div>
  );
}

function CarouselArt({ slides }: { slides: string[] }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative aspect-[4/5] h-[88%] -translate-x-2">
        {[2, 1, 0].map((depth) => (
          <div
            key={depth}
            className="absolute inset-0 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--shadow)]"
            style={{ transform: `translate(${depth * 9}px, ${depth * -2}px) scale(${1 - depth * 0.05})` }}
          >
            {depth === 0 ? (
              <div className="flex h-full flex-col justify-between p-2">
                {slides[0] ? (
                  <p className="line-clamp-4 text-[9px] font-semibold leading-tight text-white">{slides[0]}</p>
                ) : (
                  <span className="space-y-1">
                    <span className="block h-1.5 w-5/6 rounded-full bg-[var(--foreground)]/30" />
                    <span className="block h-1.5 w-3/5 rounded-full bg-[var(--foreground)]/20" />
                  </span>
                )}
                <span className="flex justify-center gap-0.5">
                  {[0, 1, 2, 3].map((dot) => (
                    <span
                      key={dot}
                      className={cn("h-1 w-1 rounded-full", dot === 0 ? "bg-[var(--accent)]" : "bg-[var(--foreground)]/25")}
                    />
                  ))}
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PostsArt({ posts }: { posts: string[] }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {[0, 1].map((index) => (
        <div
          key={index}
          className={cn(
            "flex items-start gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1.5",
            index === 1 && "ml-4"
          )}
        >
          <span className="pv-fill flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--accent)]">
            <AtSign className="h-2.5 w-2.5" />
          </span>
          {posts[index] ? (
            <p className="line-clamp-2 min-w-0 flex-1 text-[9px] leading-tight text-white/90">{posts[index]}</p>
          ) : (
            <span className="min-w-0 flex-1 space-y-1 pt-0.5">
              <span className="block h-1 rounded-full bg-[var(--foreground)]/25" />
              <span className="block h-1 w-2/3 rounded-full bg-[var(--foreground)]/15" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function VisualArt({ headline }: { headline?: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--border)]">
      <Fill>
        <Sparkles className="h-6 w-6 text-[var(--accent)]" />
      </Fill>
      {headline ? (
        <p className="absolute inset-x-2 bottom-1.5 line-clamp-2 text-[9px] font-semibold leading-tight text-[#ffffff] drop-shadow">
          {headline}
        </p>
      ) : null}
    </div>
  );
}

function ScheduleArt({ queued }: { queued: number }) {
  return (
    <div className="grid h-full w-full grid-cols-7 grid-rows-2 gap-1">
      {Array.from({ length: 14 }, (_, index) => (
        <span
          key={index}
          className={cn(
            "rounded-[5px] border",
            index < queued
              ? "border-transparent bg-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface-2)]"
          )}
        />
      ))}
    </div>
  );
}

function FlowFan({ state, flip = false }: { state: "idle" | "live" | "done"; flip?: boolean }) {
  return (
    <div
      className={cn("pv-fan h-9 w-full", state === "live" && "pv-fan-live", state === "done" && "pv-fan-done")}
      style={flip ? { transform: "scaleY(-1)" } : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 300 36" preserveAspectRatio="none" className="hidden h-full w-full sm:block">
        <path d="M150 0V10C150 24 50 20 50 36" />
        <path d="M150 0V36" />
        <path d="M150 0V10C150 24 250 20 250 36" />
      </svg>
      <svg viewBox="0 0 300 36" preserveAspectRatio="none" className="h-full w-full sm:hidden">
        <path d="M150 0V10C150 24 75 20 75 36" />
        <path d="M150 0V10C150 24 225 20 225 36" />
      </svg>
    </div>
  );
}

const TILE_EDGE: Record<PipelineStageStatus, string> = {
  ready: "border-[color-mix(in_srgb,var(--success)_30%,transparent)]",
  error: "border-[color-mix(in_srgb,var(--danger)_45%,transparent)]",
  running: "border-[color-mix(in_srgb,var(--accent)_50%,transparent)]",
  waiting: "border-[var(--border)]",
  skipped: "border-dashed border-[var(--border)]"
};

function OutputTile({
  title,
  Icon,
  status,
  meta,
  progress,
  href,
  idle,
  onSelect,
  children
}: {
  title: string;
  Icon: LucideIcon;
  status: PipelineStageStatus;
  meta?: string;
  progress?: number;
  href?: string;
  idle: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  const dim = !idle && (status === "waiting" || status === "skipped");
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-[var(--panel)] transition hover:border-[var(--border-strong)]",
        idle ? "border-[var(--border)]" : TILE_EDGE[status],
        !idle && status === "running" && "pipeline-card-live"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full p-2 text-left"
        aria-label={idle ? title : `${title}: see the steps`}
      >
        <div
          className={cn(
            "aspect-[16/10] overflow-hidden rounded-xl bg-[var(--well)] p-2 transition",
            dim && "opacity-55 saturate-50"
          )}
        >
          {children}
        </div>
        <div className="mt-2 flex items-center gap-2 px-1">
          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">{title}</span>
          {idle ? null : <StatusChip status={status} />}
        </div>
        {meta && !idle ? (
          <p className="mt-0.5 truncate px-1 text-[11px] text-[var(--muted-foreground)]" title={meta}>
            {meta}
          </p>
        ) : null}
      </button>
      {typeof progress === "number" && status === "running" ? (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/8">
          <div className="h-full bg-[var(--accent)] transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {href && status === "ready" ? (
        <Link
          href={href}
          title={`Open ${title.toLowerCase()}`}
          aria-label={`Open ${title.toLowerCase()}`}
          className="absolute right-3.5 top-3.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-[#ffffff] opacity-0 backdrop-blur-sm transition hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function combine(list: PipelineStageStatus[]): PipelineStageStatus {
  if (list.includes("error")) return "error";
  if (list.includes("running")) return "running";
  if (list.every((status) => status === "skipped")) return "skipped";
  if (list.every((status) => status === "ready" || status === "skipped")) return "ready";
  return "waiting";
}

function focusStage(keys: PipelineStageKey[], stages: Stages): PipelineStageKey {
  return (
    keys.find((key) => stages[key].status === "error") ??
    keys.find((key) => stages[key].status === "running") ??
    keys.find((key) => stages[key].status === "waiting") ??
    keys[0]
  );
}

type TileSpec = {
  id: string;
  keys: PipelineStageKey[];
  title: string;
  href?: string;
  ready: (context: BoardContext) => string;
  art: (context: BoardContext, status: PipelineStageStatus, retryKey: string) => ReactNode;
};

type BoardContext = {
  overview: PipelineRunOverview | null;
  run: PipelineRun | undefined;
};

const TILES: TileSpec[] = [
  {
    id: "longform",
    keys: ["longform", "segments"],
    title: "Long-form",
    ready: ({ overview }) => {
      const counts = overview?.schedulable;
      return counts && counts.segments > 0
        ? `${counts.segmentsRendered}/${counts.segments} topic segments`
        : "Edit ready";
    },
    art: ({ overview }, _status, retryKey) => (
      <LongformArt poster={overview?.previews?.poster} retryKey={retryKey} ticks={overview?.schedulable.segments ?? 0} />
    )
  },
  {
    id: "clips",
    keys: ["clips"],
    title: "Shorts",
    href: "/clips",
    ready: ({ overview }) => {
      const count = overview?.schedulable.clipsReady ?? 0;
      return `${count} short${count === 1 ? "" : "s"}`;
    },
    art: ({ overview }, _status, retryKey) => <ShortsArt clips={overview?.previews?.clips ?? []} retryKey={retryKey} />
  },
  {
    id: "podcast",
    keys: ["audio", "podcast"],
    title: "Podcast",
    href: "/podcast",
    ready: ({ run }) => (run?.podcastEpisodeId ? "On Spotify" : "MP3 ready"),
    art: (_context, status) => <PodcastArt live={status === "running"} done={status === "ready"} />
  },
  {
    id: "images",
    keys: ["images"],
    title: "Carousel",
    href: "/carousels",
    ready: ({ overview }) => `${overview?.schedulable.carouselSlides ?? 0} slides`,
    art: ({ overview }) => <CarouselArt slides={overview?.previews?.slides ?? []} />
  },
  {
    id: "posts",
    keys: ["posts"],
    title: "Posts",
    ready: ({ overview }) => `${overview?.schedulable.posts ?? 0} posts`,
    art: ({ run }) => <PostsArt posts={(run?.posts ?? []).map((post) => post.text)} />
  },
  {
    id: "visuals",
    keys: ["visuals"],
    title: "Visual ad",
    ready: () => "Frame picked",
    art: ({ overview }) => <VisualArt headline={overview?.visualMoment?.headline} />
  }
];

function tileHref(spec: TileSpec, run: PipelineRun | undefined): string | undefined {
  if (spec.id === "longform") return run?.longformProjectId ? `/longform?open=${run.longformProjectId}` : undefined;
  if (spec.id === "images" && run?.longformProjectId) return `/carousels?longform=${run.longformProjectId}`;
  return spec.href;
}

function SourceCard({
  stages,
  run,
  overview,
  percent,
  current
}: {
  stages: Stages;
  run: PipelineRun | undefined;
  overview: PipelineRunOverview | null;
  percent: number;
  current: { key: PipelineStageKey; status: PipelineStageStatus } | null;
}) {
  const source = stages.source;
  const CurrentIcon = current ? STAGE_ICONS[current.key] : STAGE_ICONS.schedule;
  const tone = current?.status ?? "ready";
  const done = STAGE_ORDER.filter((key) => ["ready", "skipped"].includes(stages[key].status)).length;
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-[var(--panel)] p-3 sm:flex-row sm:items-center sm:p-4",
        source.status === "running" ? "pipeline-card-live border-[color-mix(in_srgb,var(--accent)_50%,transparent)]" : "border-[var(--border)]"
      )}
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl border border-[var(--border)] sm:w-72">
        <Thumb src={overview?.previews?.poster} retryKey={source.status} fallback={<Fill><UploadCloud className="h-8 w-8 text-[var(--accent)]" /></Fill>} />
        {source.status === "running" ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-[#ffffff] backdrop-blur-[2px]">
            <Loader2 className="h-5 w-5 animate-spin" />
            {typeof source.progress === "number" ? (
              <span className="text-sm font-semibold tabular-nums">{Math.round(source.progress)}%</span>
            ) : null}
          </span>
        ) : null}
        {run?.durationSec ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#ffffff]">
            {formatDuration(run.durationSec)}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border", NODE_STYLES[tone], "opacity-100")}>
            <CurrentIcon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              {current ? (current.status === "error" ? "Stuck on" : current.status === "running" ? "Now" : "Up next") : "Finished"}
            </p>
            <p className="truncate text-sm font-semibold text-white">
              {current ? STAGE_TITLES[current.key] : "Every step has settled"}
            </p>
          </div>
          <p className="shrink-0 text-3xl font-semibold tabular-nums text-white">
            {percent}
            <span className="text-sm text-[var(--muted-foreground)]">%</span>
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-700" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
          {done} of {STAGE_ORDER.length} steps settled
        </p>
      </div>
    </div>
  );
}

function GhostSource({ onPickFile }: { onPickFile?: () => void }) {
  return (
    <button
      type="button"
      onClick={onPickFile}
      className="flex w-full flex-col items-center gap-4 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--panel)] p-3 text-left transition hover:border-[var(--accent)] sm:flex-row sm:p-4"
    >
      <span className="pv-fill flex aspect-video w-full shrink-0 items-center justify-center rounded-xl border border-[var(--border)] sm:w-72">
        <UploadCloud className="pv-float h-9 w-9 text-[var(--accent)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-white">One long video in</span>
        <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
          A stream, a VOD, a recording. Drop it or paste the link — the rest below runs on its own.
        </span>
      </span>
    </button>
  );
}

/**
 * The whole pipeline as one picture: the source frame on top, the six things
 * it becomes fanned out underneath with their real thumbnails, and the
 * scheduler they all end in. With no stages it is the empty version of the
 * same picture, which is what the home screen shows before a stream is sent.
 */
export function PipelineBoard({
  stages,
  run,
  overview,
  percent,
  current,
  onSelect,
  onPickFile,
  schedule
}: {
  stages: Stages | null;
  run?: PipelineRun;
  overview?: PipelineRunOverview | null;
  percent?: number;
  current?: { key: PipelineStageKey; status: PipelineStageStatus } | null;
  onSelect?: (key: PipelineStageKey) => void;
  onPickFile?: () => void;
  schedule?: { action: ReactNode; body: ReactNode };
}) {
  const idle = !stages;
  const context: BoardContext = { overview: overview ?? null, run };
  const tileStatuses = stages ? TILES.map((spec) => combine(spec.keys.map((key) => stages[key].status))) : [];
  const anyRunning = tileStatuses.includes("running");
  const sourceReady = stages ? stages.source.status === "ready" : false;
  const scheduleStatus = stages?.schedule.status ?? "waiting";
  const topState = idle
    ? "idle"
    : stages.source.status === "running"
      ? "live"
      : sourceReady && anyRunning
        ? "live"
        : sourceReady && !tileStatuses.includes("waiting")
          ? "done"
          : "idle";
  const bottomState = idle
    ? "idle"
    : anyRunning || scheduleStatus === "running"
      ? "live"
      : scheduleStatus === "ready"
        ? "done"
        : "idle";

  return (
    <section aria-label="Pipeline">
      {stages ? (
        <SourceCard stages={stages} run={run} overview={overview ?? null} percent={percent ?? 0} current={current ?? null} />
      ) : (
        <GhostSource onPickFile={onPickFile} />
      )}
      <FlowFan state={topState} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TILES.map((spec, index) => {
          const status = tileStatuses[index] ?? "waiting";
          const focus = stages ? focusStage(spec.keys, stages) : spec.keys[0];
          const focusDetail = stages?.[focus];
          const meta =
            status === "ready"
              ? spec.ready(context)
              : status === "running" || status === "error" || status === "skipped"
                ? focusDetail?.detail
                : undefined;
          return (
            <div key={spec.id} className="pipeline-hero-enter" style={{ animationDelay: `${index * 45}ms` }}>
              <OutputTile
                title={spec.title}
                Icon={STAGE_ICONS[spec.keys[0]]}
                status={status}
                meta={meta}
                progress={focusDetail?.progress}
                href={tileHref(spec, run)}
                idle={idle}
                onSelect={idle ? undefined : () => onSelect?.(focus)}
              >
                {spec.art(context, status, stages?.[spec.keys[0]].status ?? "")}
              </OutputTile>
            </div>
          );
        })}
      </div>
      <FlowFan state={bottomState} flip />
      <div
        id="stage-schedule"
        className={cn(
          "scroll-mt-24 rounded-2xl border bg-[var(--panel)] p-3 sm:p-4",
          idle ? "border-[var(--border)]" : TILE_EDGE[scheduleStatus],
          !idle && scheduleStatus === "running" && "pipeline-card-live"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="h-10 w-28 shrink-0 sm:w-40">
            <ScheduleArt queued={overview?.schedulable.queued ?? 0} />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{STAGE_TITLES.schedule}</span>
              {idle ? null : <StatusChip status={scheduleStatus} />}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted-foreground)]">
              {idle
                ? "Everything lands in your calendar, one per free slot."
                : scheduleStatus === "waiting"
                  ? "Outputs land here as each one finishes."
                  : stages?.schedule.detail}
            </p>
          </div>
          {schedule?.action ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{schedule.action}</div>
          ) : null}
        </div>
        {schedule?.body}
      </div>
    </section>
  );
}

export function RunThumb({ entry, className }: { entry: PipelineRunOverview; className?: string }) {
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-lg border border-[var(--border)]", className)}>
      <Thumb src={entry.previews?.poster} retryKey={entry.stages.longform.status} fallback={<Fill><UploadCloud className="h-4 w-4 text-[var(--accent)]" /></Fill>} />
    </div>
  );
}

const STRIP_SEGMENT: Record<PipelineStageStatus, string> = {
  ready: "bg-[color-mix(in_srgb,var(--success)_65%,transparent)]",
  error: "tone-danger tone-fill",
  running: "bg-[var(--accent)] animate-pulse",
  waiting: "bg-white/10",
  skipped: "bg-white/5"
};

export function StageStrip({ stages, className }: { stages: Stages; className?: string }) {
  return (
    <span className={cn("flex gap-0.5", className)} aria-hidden="true">
      {STAGE_ORDER.map((key) => (
        <span key={key} className={cn("h-1 flex-1 rounded-full", STRIP_SEGMENT[stages[key].status])} title={STAGE_TITLES[key]} />
      ))}
    </span>
  );
}
