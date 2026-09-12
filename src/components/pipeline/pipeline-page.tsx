"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  AtSign,
  CalendarClock,
  Check,
  Clapperboard,
  Copy,
  Download,
  Images,
  Layers,
  Loader2,
  Plus,
  Podcast,
  Radio,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  UploadCloud,
  type LucideIcon
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { VisualAdComposer } from "@/components/pipeline/visual-ad-composer";
import type { QueuePlan } from "@/lib/pipeline/queueOutputs";
import { usePipelineAttention, useRefreshAttention } from "@/components/pipeline/attention";
import { useStream } from "@/components/providers/stream-provider";
import { useAppData } from "@/components/providers/app-provider";
import { runListStatus, type RunTone } from "@/lib/pipeline/status";
import { runProgress } from "@/lib/pipeline/progress";
import {
  DEFAULT_OUTPUT_QUALITY,
  OUTPUT_FRAME_RATES,
  OUTPUT_RESOLUTIONS,
  describeOutputQuality,
  normalizeOutputQuality,
  type OutputQuality
} from "@/lib/pipeline/outputQuality";
import { ChannelCoverageCard } from "@/components/pipeline/channel-coverage";
import type { ChannelCoverage } from "@/lib/ingest/coverage";
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { routeLabel } from "@/lib/colateral/routes";
import { cn } from "@/lib/utils";
import type {
  PipelinePost,
  PipelineRun,
  PipelineRunOverview,
  PipelineStage,
  PipelineStageKey,
  PipelineStageStatus
} from "@/lib/pipeline/types";

const STATUS_STYLES: Record<PipelineStageStatus, string> = {
  ready: "tone-success tone-edge tone-soft tone-text",
  error: "tone-danger tone-edge tone-soft tone-text",
  running: "tone-info tone-edge tone-soft tone-text",
  waiting: "border-white/10 bg-white/5 text-[var(--muted-foreground)]",
  skipped: "tone-warning tone-edge tone-soft tone-text"
};

const STATUS_LABELS: Record<PipelineStageStatus, string> = {
  ready: "Ready",
  error: "Needs attention",
  running: "Working",
  waiting: "Waiting",
  skipped: "Skipped"
};

const STATUS_DOT: Record<PipelineStageStatus, string> = {
  ready: "tone-success tone-fill",
  error: "tone-danger tone-fill",
  running: "tone-info tone-fill animate-pulse",
  waiting: "bg-white/20",
  skipped: "tone-warning tone-fill"
};

// What each stage is called wherever it is named — the row heading, the output
// strip and the "these stopped short" summary must say the same word for the
// same thing.
const STAGE_TITLES: Record<PipelineStageKey, string> = {
  source: "Stream source",
  longform: "Long-form edit",
  segments: "Topic segments",
  clips: "Short-form clips",
  audio: "Podcast MP3",
  podcast: "Spotify episode",
  images: "Carousel images",
  visuals: "Realistic visual ads",
  posts: "Text-only posts",
  schedule: "Scheduler"
};

const STAGE_ICONS: Record<PipelineStageKey, LucideIcon> = {
  source: UploadCloud,
  longform: Clapperboard,
  segments: Layers,
  clips: Scissors,
  audio: Podcast,
  podcast: Radio,
  images: Images,
  visuals: Sparkles,
  posts: AtSign,
  schedule: CalendarClock
};

const STAGE_ORDER: PipelineStageKey[] = [
  "source",
  "longform",
  "segments",
  "clips",
  "audio",
  "podcast",
  "images",
  "visuals",
  "posts",
  "schedule"
];

const RUN_TONE_DOT: Record<RunTone, string> = {
  attention: "tone-warning tone-fill",
  working: "tone-info tone-fill animate-pulse",
  done: "tone-success tone-fill"
};

const RUN_TONE_TEXT: Record<RunTone, string> = {
  attention: "tone-warning tone-text",
  working: "text-[var(--muted-foreground)]",
  done: "text-[var(--muted-foreground)]"
};

const POST_PLATFORM_LABELS: Record<PipelinePost["platform"], string> = {
  x: "X",
  threads: "Threads",
  facebook: "FB / LinkedIn"
};

// Rendered the instant a stream is submitted, before the server has echoed a
// run back — so the flow builds itself on screen rather than appearing later.
const LAUNCHING_STAGES: Record<PipelineStageKey, PipelineStage> = {
  source: { status: "running", detail: "Pulling the stream in..." },
  longform: { status: "waiting", detail: "Waiting for the source." },
  segments: { status: "waiting", detail: "Waiting for the full transcript." },
  clips: { status: "waiting", detail: "Waiting for the source." },
  audio: { status: "waiting", detail: "Waiting for the long-form export." },
  podcast: { status: "waiting", detail: "Waiting for the MP3." },
  images: { status: "waiting", detail: "Waiting for the transcript." },
  visuals: { status: "waiting", detail: "Waiting for a moment worth shooting." },
  posts: { status: "waiting", detail: "Waiting for the transcript." },
  schedule: { status: "waiting", detail: "Waiting for the first output." }
};

const SMALL_BUTTON = "px-3 py-1.5 text-xs";

function formatStartedAt(iso: string) {
  const started = new Date(iso);
  if (Number.isNaN(started.getTime())) return "Unknown date";
  const today = new Date();
  const sameDay = started.toDateString() === today.toDateString();
  const time = started.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  return `${started.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function StatusChip({ status }: { status: PipelineStageStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status]
      )}
    >
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "ready" && <Check className="h-3 w-3" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

function Spinner() {
  return <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />;
}

function CopyPostButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy — select the text instead.");
        }
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
      aria-label="Copy post"
      title="Copy post"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * The one control the app opens on: a single pill that takes a link, a click to
 * upload, or a dropped file.
 */
function StreamSearchBar({
  value,
  onChange,
  onSubmit,
  onPickFile,
  busy
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onPickFile: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 shadow-[var(--shadow-pop)] transition focus-within:border-[var(--accent)] focus-within:shadow-[0_8px_44px_color-mix(in_srgb,var(--accent)_18%,transparent)]">
      <button
        type="button"
        onClick={onPickFile}
        disabled={busy}
        aria-label="Upload a video file"
        title="Upload a video file"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition hover:bg-white/8 hover:text-white disabled:opacity-40"
      >
        <Plus className="h-5 w-5" />
      </button>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
        }}
        disabled={busy}
        placeholder="Paste a stream or VOD link"
        aria-label="Stream or VOD link"
        className="h-10 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || !value.trim()}
        aria-label="Run the pipeline"
        title="Run the pipeline"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] transition hover:opacity-90 disabled:bg-white/10 disabled:text-[var(--muted-foreground)]"
      >
        {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
      </button>
    </div>
  );
}

const SELECT_CLASS =
  "h-8 cursor-pointer appearance-none rounded-full border border-[var(--border)] bg-[var(--surface-2)] pl-3 pr-7 text-xs text-white outline-none transition hover:border-[var(--border-strong)] focus:border-[var(--accent)] disabled:opacity-50";

/**
 * The only two settings the pipeline asks for. They live under the search bar,
 * are remembered for the next stream, and travel with the run they started.
 */
function OutputQualityPicker({
  value,
  onChange,
  disabled
}: {
  value: OutputQuality;
  onChange: (next: OutputQuality) => void;
  disabled: boolean;
}) {
  const chevron = (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted-foreground)]">
      ▾
    </span>
  );
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
      <label className="relative flex items-center gap-1.5">
        <span>Resolution</span>
        <select
          value={value.resolution}
          disabled={disabled}
          aria-label="Output resolution"
          onChange={(event) =>
            onChange(normalizeOutputQuality({ ...value, resolution: event.target.value }))
          }
          className={SELECT_CLASS}
        >
          {OUTPUT_RESOLUTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {chevron}
      </label>
      <label className="relative flex items-center gap-1.5">
        <span>Frame rate</span>
        <select
          value={value.frameRate}
          disabled={disabled}
          aria-label="Output frame rate"
          onChange={(event) =>
            onChange(normalizeOutputQuality({ ...value, frameRate: event.target.value }))
          }
          className={SELECT_CLASS}
        >
          {OUTPUT_FRAME_RATES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {chevron}
      </label>
    </div>
  );
}

type OutputChip = { key: PipelineStageKey; label: string; status: PipelineStageStatus };

/**
 * What one stream turns into, in one line: every format with a dot for where
 * it has got to. Clicking a chip lands on that stage of the flow.
 */
function OutputStrip({ chips }: { chips: OutputChip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const Icon = STAGE_ICONS[chip.key];
        return (
          <a
            key={chip.key}
            href={`#stage-${chip.key}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(`stage-${chip.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition hover:border-[var(--border-strong)]",
              chip.status === "ready"
                ? "tone-success tone-edge tone-soft text-white"
                : chip.status === "running"
                  ? "tone-info tone-edge tone-soft text-white"
                  : chip.status === "error"
                    ? "tone-danger tone-edge tone-soft text-white"
                    : "border-[var(--border)] text-[var(--muted-foreground)]"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[chip.status])} />
            <Icon className="h-3 w-3" />
            {chip.label}
          </a>
        );
      })}
    </div>
  );
}

/** One node in the top-to-bottom flow: icon on the rail, card to the right. */
function StageRow({
  stageKey,
  stage,
  index,
  last = false,
  flowing = false,
  onRetry,
  retrying = false,
  action,
  children
}: {
  stageKey: PipelineStageKey;
  stage: PipelineStage;
  index: number;
  last?: boolean;
  flowing?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const Icon = STAGE_ICONS[stageKey];
  const active = stage.status === "running";
  const done = stage.status === "ready";
  return (
    <div id={`stage-${stageKey}`} className="animate-in flex gap-4 scroll-mt-24" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
            done
              ? "tone-success tone-edge tone-soft tone-text"
              : active
                ? "pipeline-node-live tone-info tone-edge tone-soft tone-text"
                : stage.status === "error"
                  ? "tone-danger tone-edge tone-soft tone-text"
                  : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted-foreground)]"
          )}
        >
          <Icon className="h-4.5 w-4.5" />
          {active && (
            <span className="pipeline-orbit pointer-events-none absolute -inset-1 rounded-full border border-transparent border-t-[color-mix(in_srgb,var(--info)_70%,transparent)]" />
          )}
        </div>
        {!last && (
          <div
            className={cn(
              "w-px flex-1",
              flowing ? "pipeline-rail-live bg-[var(--border)]" : done ? "tone-success tone-soft" : "bg-[var(--border)]"
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <Card className={cn("p-4", active && "pipeline-card-live tone-info tone-edge")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{STAGE_TITLES[stageKey]}</h3>
            <StatusChip status={stage.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{stage.detail}</p>
          {stage.status === "running" && typeof stage.progress === "number" && (
            <Progress value={stage.progress} className="mt-3" />
          )}
          {onRetry || action ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {onRetry ? (
                <Button
                  variant="secondary"
                  onClick={onRetry}
                  disabled={retrying}
                  className={cn(
                    SMALL_BUTTON,
                    "tone-warning tone-edge tone-text hover:border-[color-mix(in_srgb,var(--warning)_50%,transparent)]"
                  )}
                >
                  {retrying ? <Spinner /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                  Try this again
                </Button>
              ) : null}
              {action}
            </div>
          ) : null}
          {children}
        </Card>
      </div>
    </div>
  );
}

function OpenLink({ href, label = "Open" }: { href: string; label?: string }) {
  return (
    <Link href={href}>
      <Button variant="secondary" className={SMALL_BUTTON}>
        {label}
      </Button>
    </Link>
  );
}

export function PipelinePage() {
  // ?run=<id> is how the command bar opens one run: "pull up the Day 13 run"
  // has to land on that run, not on the list with it buried in it.
  const requestedRunId = useSearchParams().get("run");
  const pathname = usePathname();
  const { select: selectStream } = useStream();
  const { data, mutate } = useAppData();
  const [overviews, setOverviews] = useState<PipelineRunOverview[]>([]);
  const [coverage, setCoverage] = useState<ChannelCoverage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(requestedRunId);
  // The app opens on the bare search bar; the flow only exists once a stream has
  // been sent through it (or a past run is picked up again).
  const [showFlow, setShowFlow] = useState(Boolean(requestedRunId));
  const [launching, setLaunching] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Which stage's button is mid-request, so only that row spins.
  const [working, setWorking] = useState<string | null>(null);
  // The booking sheet: what would be scheduled, and what he has unticked.
  const [plan, setPlan] = useState<QueuePlan | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const { scan } = usePipelineAttention();
  const refreshAttention = useRefreshAttention();
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [postsOpen, setPostsOpen] = useState(false);

  const outputQuality = useMemo(
    () => normalizeOutputQuality(data.settings.outputQuality ?? DEFAULT_OUTPUT_QUALITY),
    [data.settings.outputQuality]
  );
  const setOutputQuality = useCallback(
    (next: OutputQuality) => {
      void mutate("updateSettings", { ...data.settings, outputQuality: next });
    },
    [data.settings, mutate]
  );

  // While a brand-new run is being created there is no id to match yet, so the
  // flow must NOT fall back to the newest previous run — it renders the
  // launching skeleton instead until the server hands back the real run.
  const active = useMemo(() => {
    if (activeRunId) return overviews.find((entry) => entry.run.id === activeRunId) ?? null;
    if (launching) return null;
    return overviews[0] ?? null;
  }, [activeRunId, launching, overviews]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/pipeline", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { runs: PipelineRunOverview[]; coverage?: ChannelCoverage | null };
      setOverviews(payload.runs);
      setCoverage(payload.coverage ?? null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling the overview is what advances the run server-side, so keep a slow
  // heartbeat even when everything looks settled — a stage the user retried in
  // another tab (or a finished export) gets picked up without a reload.
  useEffect(() => {
    const busy = overviews.some((entry) => !entry.settled);
    const timer = setInterval(() => void refresh(), busy ? 2500 : 15000);
    return () => clearInterval(timer);
  }, [overviews, refresh]);

  const startRun = useCallback(
    async (body: { url?: string; sourceId?: string; name?: string }) => {
      setShowFlow(true);
      setLaunching(true);
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, output: outputQuality })
      });
      const payload = (await response.json()) as { run?: PipelineRun; error?: string };
      if (response.ok && payload.run) {
        setActiveRunId(payload.run.id);
        setPostsOpen(false);
        setUrl("");
        selectStream(payload.run.id);
        toast.success("Pipeline started. Everything runs from here.");
        await refresh();
        setLaunching(false);
        return payload.run;
      }
      setLaunching(false);
      setShowFlow(overviews.length > 0);
      toast.error(payload.error ?? "Could not start the pipeline.");
      return null;
    },
    [outputQuality, overviews.length, refresh, selectStream]
  );

  const submitUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      toast.error("Paste a full stream or VOD link starting with http:// or https://.");
      return;
    }
    setSubmitting(true);
    try {
      await startRun({ url: trimmed });
    } catch {
      setLaunching(false);
      toast.error("Request failed. Is the dev server still running?");
    } finally {
      setSubmitting(false);
    }
  }, [startRun, url]);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setShowFlow(true);
      setLaunching(true);
      try {
        const response = await fetch(`/api/clips/sources?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "video/mp4" },
          body: file
        });
        const payload = (await response.json()) as { source?: { id: string }; error?: string };
        if (!response.ok || !payload.source) {
          setLaunching(false);
          toast.error(payload.error ?? "Upload failed.");
          return;
        }
        await startRun({ sourceId: payload.source.id });
      } catch {
        setLaunching(false);
        toast.error("Upload failed. Is the dev server still running?");
      } finally {
        setUploading(false);
      }
    },
    [startRun]
  );

  const busy = submitting || uploading;

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (busy) return;
      const file = Array.from(event.dataTransfer.files).find(
        (item) => item.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(item.name)
      );
      if (!file) {
        toast.error("Drop a video file (mp4, mov, mkv, webm...).");
        return;
      }
      void uploadFile(file);
    },
    [busy, uploadFile]
  );

  const shownRunId = active?.run.id ?? null;
  const deleteRun = useCallback(
    async (runId: string) => {
      try {
        const response = await fetch(`/api/pipeline/${runId}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        const remaining = overviews.filter((entry) => entry.run.id !== runId);
        setOverviews(remaining);
        // Removing the run you were reading goes back to the search screen.
        // Clearing the id alone would silently swap the flow to the NEWEST run,
        // which reads as "it threw me back to the top of the pipeline".
        if (activeRunId === runId || shownRunId === runId) {
          setActiveRunId(null);
          setShowFlow(false);
        }
        toast.success("Run removed. Its outputs stay in their own tools.");
      } catch {
        toast.error("Could not remove the run.");
      }
    },
    [activeRunId, overviews, shownRunId]
  );

  /**
   * The one place a stuck stage gets started again — the same repairs the
   * command bar calls, so the button and the sentence agree. The reply carries
   * the fresh overview, so the row updates now instead of on the next poll.
   */
  const startAgain = useCallback(
    async (
      runId: string,
      body:
        | { stage: string }
        | {
            action:
              | "segment"
              | "segments-all"
              | "retry-all"
              | "queue-posts"
              | "stop-queueing"
              | "dismiss-failures";
          },
      pendingKey: string
    ) => {
      setWorking(pendingKey);
      try {
        const response = await fetch(`/api/pipeline/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = (await response.json()) as {
          detail?: string;
          error?: string;
          refused?: string[];
          overview?: PipelineRunOverview;
        };
        if (!response.ok || !payload.overview) {
          toast.error(payload.error ?? "That could not be started again.");
          return;
        }
        setOverviews((current) =>
          current.map((entry) => (entry.run.id === runId ? payload.overview! : entry))
        );
        // Naming what refused is the difference between "1 could not be" and
        // knowing which row is still broken.
        for (const refusal of payload.refused ?? []) toast.error(refusal);
        toast.success(payload.detail ?? "Started again.");
      } catch {
        toast.error("Request failed. Is the server still running?");
      } finally {
        setWorking(null);
      }
    },
    []
  );

  const loadPlan = useCallback(async (runId: string) => {
    setWorking("plan");
    try {
      const response = await fetch(`/api/pipeline/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan-queue" })
      });
      const payload = (await response.json()) as { plan?: QueuePlan; error?: string };
      if (!response.ok || !payload.plan) {
        toast.error(payload.error ?? "Could not work out what is ready.");
        return;
      }
      // A row the server marked as decided opens UNTICKED. Clearing this was
      // the sheet re-ticking exactly what he had held back, under a label
      // telling him to tick it.
      setDropped(payload.plan.candidates.filter((item) => item.heldBack).map((item) => item.id));
      setPlan(payload.plan);
    } catch {
      toast.error("Request failed. Is the server still running?");
    } finally {
      setWorking(null);
    }
  }, []);

  const confirmQueue = useCallback(
    async (runId: string, ids: string[], seen: string[]) => {
      setWorking("queue");
      try {
        const response = await fetch(`/api/pipeline/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "queue-all", ids, seen })
        });
        const payload = (await response.json()) as {
          detail?: string;
          error?: string;
          queued?: { title: string }[];
          failed?: { title: string; error: string }[];
          overview?: PipelineRunOverview;
        };
        if (!response.ok) {
          toast.error(payload.error ?? "Nothing could be scheduled.");
          return;
        }
        if (payload.overview) {
          setOverviews((current) => current.map((entry) => (entry.run.id === runId ? payload.overview! : entry)));
        }
        // A booking that half worked has to say which half — the queue is the
        // one place a silent gap turns into a day with nothing posted. Nothing
        // scheduled is a failure, whatever the response code says, and the sheet
        // stays open so the untouched list is still there to try again.
        for (const failure of payload.failed ?? []) toast.error(`${failure.title}: ${failure.error}`);
        const booked = payload.queued?.length ?? 0;
        if (booked === 0) {
          toast.error(payload.detail ?? "Nothing could be scheduled.");
          return;
        }
        toast.success(payload.detail ?? "Scheduled.");
        setPlan(null);
      } catch {
        toast.error("Request failed. Is the server still running?");
      } finally {
        setWorking(null);
      }
    },
    []
  );

  /** Runs the scan again from here, rather than sending him to another screen. */
  const rescan = useCallback(async () => {
    setWorking("scan");
    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        toast.error(payload.error ?? "The scan could not be started.");
        return;
      }
      toast.success("Scanning the channel again.");
      // The row he just acted on is driven by the 60s poll; without this it
      // keeps showing the old failure for another minute.
      refreshAttention();
    } catch {
      toast.error("Request failed. Is the server still running?");
    } finally {
      setWorking(null);
    }
  }, [refreshAttention]);

  /**
   * Runs the same link through the pipeline again and drops the dead run, so a
   * failed download is one button rather than a copy-paste and a delete.
   */
  const restartRun = useCallback(
    async (runId: string, sourceUrl: string, name: string) => {
      setWorking("restart");
      try {
        const response = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: sourceUrl, name, output: outputQuality })
        });
        const payload = (await response.json()) as { run?: PipelineRun; error?: string };
        if (!response.ok || !payload.run) {
          toast.error(payload.error ?? "Could not start it again.");
          return;
        }
        // Only once the new run exists: losing the old one AND the new start
        // would leave nothing on screen and the link gone with it.
        await fetch(`/api/pipeline/${runId}`, { method: "DELETE" }).catch(() => undefined);
        setActiveRunId(payload.run.id);
        selectStream(payload.run.id);
        toast.success("Downloading the stream again.");
        await refresh();
      } catch {
        toast.error("Request failed. Is the server still running?");
      } finally {
        setWorking(null);
      }
    },
    [outputQuality, refresh, selectStream]
  );

  // Opening a run scrolls back to the top of the page. Opening one IS choosing
  // what you work on, so the shell is told at the same moment.
  const openRun = useCallback(
    (runId: string) => {
      setActiveRunId(runId);
      setPostsOpen(false);
      setPlan(null);
      setShowFlow(true);
      selectStream(runId);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    },
    [selectStream]
  );

  const backToSearch = useCallback(() => {
    setShowFlow(false);
    setLaunching(false);
    setActiveRunId(null);
    setPlan(null);
    setUrl("");
  }, []);

  const run = active?.run;
  const stages = active?.stages ?? (launching ? LAUNCHING_STAGES : null);
  const schedulable = active?.schedulable;
  // The posts go to the Threads queue, not the video booking sheet, so the
  // retry offered has to be the one that matches what failed.
  const bookingFailure = Boolean(run?.queueFailures?.length) && run?.queueFailures?.[0].title !== "Text posts";
  const longformHref = run?.longformProjectId ? `/longform?open=${run.longformProjectId}` : "/longform";
  // The segments stage opens the editor already on its segment picker,
  // rather than on the full stream with the segments a tab away.
  const segmentsHref = run?.longformProjectId ? `${longformHref}&segment=topic-1` : "/longform";
  const segmentsPending = schedulable ? schedulable.segments - schedulable.segmentsRendered : 0;
  const audioHref =
    run?.longformProjectId && run.longformExportId
      ? `/api/longform/projects/${run.longformProjectId}/export/${run.longformExportId}/audio?download=1`
      : null;

  const dragProps = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop
  };

  // The nightly scan is what fills this page while he sleeps, so when it fails
  // it has to say so HERE — the sidebar count that flags it points at this
  // screen, and this screen had never heard of scanning.
  const scanTrouble = scan && scan.status !== "ok" ? scan : null;
  const scanNotice = scanTrouble ? (
    <Card className="tone-warning tone-edge tone-soft mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
      <p className="tone-warning tone-text min-w-0 text-sm">
        {scanTrouble.status === "not-connected"
          ? "The nightly channel scan has nothing to look at — YouTube is not connected."
          : scanTrouble.status === "needs-reconnect"
            ? "The nightly channel scan cannot read the channel any more — YouTube needs reconnecting."
            : scanTrouble.status === "stale"
              ? `The channel has not been scanned since ${formatStartedAt(scanTrouble.at)} — the nightly task may not be running.`
              : `The last channel scan failed${scanTrouble.error ? ` — ${scanTrouble.error}` : "."}`}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {scanTrouble.status === "not-connected" || scanTrouble.status === "needs-reconnect" ? (
          <OpenLink href="/uploading-center" label="Connect the channel" />
        ) : (
          <Button variant="secondary" disabled={working === "scan"} onClick={() => void rescan()} className={SMALL_BUTTON}>
            {working === "scan" ? <Spinner /> : null}
            Scan now
          </Button>
        )}
      </div>
    </Card>
  ) : null;

  const fileInput = (
    <input
      ref={uploadInputRef}
      type="file"
      accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadFile(file);
      }}
    />
  );

  // This screen is mounted at both "/" and its "/pipeline" alias, so the
  // route and title follow whichever one the app is actually on rather than
  // hard-coding either.
  const surfaceRoute = pathname || "/";
  useColateralSurface({
    route: surfaceRoute,
    title: routeLabel(surfaceRoute),
    summary: "Paste a stream link to run it through the whole pipeline, or open a run already in flight.",
    fields: [
      {
        id: "url",
        label: "Stream or VOD link",
        value: url,
        kind: "text",
        hint: "Paste a full http(s) link, then press Start pipeline."
      },
      {
        id: "resolution",
        label: "Output resolution",
        value: outputQuality.resolution,
        kind: "select",
        options: OUTPUT_RESOLUTIONS.map((option) => option.id)
      },
      {
        id: "frameRate",
        label: "Output frame rate",
        value: outputQuality.frameRate,
        kind: "select",
        options: OUTPUT_FRAME_RATES.map((option) => option.id)
      }
    ],
    controls: [
      { id: "submit", label: "Start pipeline", group: "Import", disabled: busy || !url.trim() },
      { id: "back-to-search", label: "Start a new stream", group: "Import", disabled: !showFlow },
      { id: "rescan", label: "Scan the channel now", group: "Channel", disabled: working === "scan" },
      {
        id: "retry-all",
        label: "Try failed stages again",
        group: "Stage",
        disabled: !(run && active && active.retryable.length > 0)
      },
      { id: "delete-active-run", label: "Remove this run", group: "Run", disabled: !run, destructive: true }
    ],
    readings: [
      { label: "Runs in flight", value: String(overviews.filter((entry) => !entry.settled).length) },
      { label: "Total runs", value: String(overviews.length) },
      { label: "Active run", value: run?.name ?? "None" },
      { label: "Channel scan", value: scanTrouble ? scanTrouble.status : "ok" }
    ],
    setField: (id, value) => {
      if (id === "url") {
        if (typeof value !== "string") return false;
        setUrl(value);
        return true;
      }
      if (id === "resolution") {
        if (typeof value !== "string" || !OUTPUT_RESOLUTIONS.some((option) => option.id === value)) return false;
        setOutputQuality(normalizeOutputQuality({ ...outputQuality, resolution: value }));
        return true;
      }
      if (id === "frameRate") {
        if (typeof value !== "string" || !OUTPUT_FRAME_RATES.some((option) => option.id === value)) return false;
        setOutputQuality(normalizeOutputQuality({ ...outputQuality, frameRate: value }));
        return true;
      }
      return false;
    },
    click: (id) => {
      if (id === "submit") {
        if (busy || !url.trim()) return false;
        void submitUrl();
        return true;
      }
      if (id === "back-to-search") {
        if (!showFlow) return false;
        backToSearch();
        return true;
      }
      if (id === "rescan") {
        if (working === "scan") return false;
        void rescan();
        return true;
      }
      if (id === "retry-all") {
        if (!run || !active || active.retryable.length === 0) return false;
        void startAgain(run.id, { action: "retry-all" }, "retry-all");
        return true;
      }
      if (id === "delete-active-run") {
        if (!run) return false;
        void deleteRun(run.id);
        return true;
      }
      return false;
    }
  });

  // Names are shown in FULL and stamped with when the run started — a channel
  // posts the same series week after week, so four runs can share a title and
  // a truncated pill leaves nothing to tell them apart by.
  const runList = (compact = false) => {
    const listed = compact ? overviews.filter((entry) => entry.run.id !== run?.id) : overviews.slice(0, 6);
    return listed.length === 0 ? null : (
      <div className={compact ? "mt-2" : "mt-8"}>
        <p className="pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          {compact ? "Other streams" : "Earlier pipelines"}
        </p>
        <div
          className={cn(
            "grid gap-2 sm:grid-cols-2",
            compact && listed.length > 4 && "max-h-64 overflow-y-auto pr-1"
          )}
        >
          {listed.map((entry) => {
            const status = runListStatus(entry);
            const progress = runProgress(entry);
            return (
              <div
                key={entry.run.id}
                className="group flex items-start gap-2 rounded-xl border border-[var(--border)] px-3 py-2 transition hover:border-[var(--border-strong)] hover:bg-white/4"
              >
                <button
                  type="button"
                  onClick={() => openRun(entry.run.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  title={`Open ${entry.run.name}`}
                >
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", RUN_TONE_DOT[status.tone])} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-medium text-white/90">{entry.run.name}</span>
                    <span className={cn("mt-0.5 block text-[11px]", RUN_TONE_TEXT[status.tone])}>
                      {status.label} · {formatStartedAt(entry.run.createdAt)}
                    </span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/8">
                      <span
                        className={cn(
                          "block h-full rounded-full transition-all",
                          status.tone === "attention"
                            ? "tone-danger tone-fill"
                            : progress.percent === 100
                              ? "tone-success tone-fill"
                              : "tone-info tone-fill"
                        )}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </span>
                    {progress.outputs.length > 0 && (
                      <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
                        {progress.outputs.join(" · ")}
                      </span>
                    )}
                    {progress.delivery && (
                      <span
                        className={cn(
                          "mt-0.5 block text-[11px]",
                          entry.delivery.posted > 0 ? "tone-success tone-text" : "text-[var(--muted-foreground)]"
                        )}
                      >
                        {progress.delivery}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRun(entry.run.id)}
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition hover:text-[var(--danger)] focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Remove ${entry.run.name}`}
                  title="Remove run"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (!showFlow) {
    return (
      <div
        {...dragProps}
        className={cn(
          "flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center rounded-2xl border border-transparent px-4 transition",
          dragActive && "border-dashed border-[var(--accent)] bg-white/3"
        )}
      >
        <div className="pipeline-hero-enter w-full max-w-2xl">
          {scanNotice}
          <h1 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {dragActive ? "Drop it anywhere." : "Ready when you are."}
          </h1>
          <div className="mt-8">
            <StreamSearchBar
              value={url}
              onChange={setUrl}
              onSubmit={() => void submitUrl()}
              onPickFile={() => uploadInputRef.current?.click()}
              busy={busy}
            />
          </div>
          <div className="mt-4">
            <OutputQualityPicker value={outputQuality} onChange={setOutputQuality} disabled={busy} />
          </div>
          <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
            One stream in — long-form edit, shorts, MP3, carousel, and posts come back out.
          </p>
          {loaded ? (
            <ChannelCoverageCard
              coverage={coverage}
              onRun={(link) => void startRun({ url: link })}
              starting={busy || launching}
              rescanning={working === "scan"}
              onRescan={() => void rescan()}
            />
          ) : null}
          {loaded ? (
            runList()
          ) : (
            // Never render this screen as a bare "no runs" state. The first
            // fetch can be slow (or blocked behind heavy work), and an empty
            // landing page made a run that was mid-flight look like it had
            // never existed.
            <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">
              Checking for runs already in flight…
            </p>
          )}
        </div>
        {fileInput}
      </div>
    );
  }

  const chips: OutputChip[] = stages
    ? [
        {
          key: "longform",
          label: "Long-form",
          status: stages.longform.status
        },
        {
          key: "segments",
          label:
            schedulable && schedulable.segments > 0
              ? `Segments ${schedulable.segmentsRendered}/${schedulable.segments}`
              : "Segments",
          status: stages.segments.status
        },
        {
          key: "clips",
          label: schedulable && schedulable.clipsReady > 0 ? `${schedulable.clipsReady} shorts` : "Shorts",
          status: stages.clips.status
        },
        { key: "audio", label: "MP3", status: stages.audio.status },
        { key: "podcast", label: "Spotify", status: stages.podcast.status },
        {
          key: "images",
          label:
            schedulable && schedulable.carouselSlides > 0 ? `${schedulable.carouselSlides}-slide carousel` : "Carousel",
          status: stages.images.status
        },
        { key: "visuals", label: "Visual ad", status: stages.visuals.status },
        {
          key: "posts",
          label: schedulable && schedulable.posts > 0 ? `${schedulable.posts} posts` : "Posts",
          status: stages.posts.status
        },
        {
          key: "schedule",
          label: schedulable && schedulable.queued > 0 ? `${schedulable.queued} scheduled` : "Schedule",
          status: stages.schedule.status
        }
      ]
    : [];

  const stageAction = (key: PipelineStageKey): React.ReactNode => {
    if (!stages) return null;
    const status = stages[key].status;
    switch (key) {
      case "source":
        return run?.status === "error" && run.sourceUrl ? (
          <Button
            disabled={working === "restart"}
            onClick={() => void restartRun(run.id, run.sourceUrl!, run.name)}
            className={SMALL_BUTTON}
          >
            {working === "restart" ? <Spinner /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
            Start this stream again
          </Button>
        ) : null;
      case "longform":
        return status === "ready" ? <OpenLink href={longformHref} label="Open the edit" /> : null;
      case "segments":
        if (!run || !schedulable || schedulable.segments === 0) return null;
        if (segmentsPending > 0) {
          return (
            <>
              <Button
                disabled={working === "segments-all" || run.renderAllSegments === true}
                onClick={() => void startAgain(run.id, { action: "segments-all" }, "segments-all")}
                className={SMALL_BUTTON}
              >
                {working === "segments-all" ? <Spinner /> : <Layers className="mr-1.5 h-3.5 w-3.5" />}
                {run.renderAllSegments
                  ? `Rendering ${segmentsPending} — one at a time`
                  : `Render all ${segmentsPending} segments`}
              </Button>
              <span className="text-xs text-[var(--muted-foreground)]">
                {schedulable.segmentsRendered} of {schedulable.segments} rendered
              </span>
            </>
          );
        }
        return <OpenLink href={segmentsHref} label="Watch the segments" />;
      case "clips":
        return status === "ready" ? <OpenLink href="/clips" label="Open the clips" /> : null;
      case "audio":
        return status === "ready" && audioHref ? (
          <a href={audioHref}>
            <Button variant="secondary" className={SMALL_BUTTON}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download MP3
            </Button>
          </a>
        ) : null;
      case "podcast":
        return status === "ready" ? <OpenLink href="/podcast" label="Open the episode" /> : null;
      case "images":
        return run?.carouselId ? (
          <OpenLink
            href={run.longformProjectId ? `/carousels?longform=${run.longformProjectId}` : "/carousels"}
            label="Open the carousel"
          />
        ) : null;
      case "posts":
        return run?.posts && run.posts.length > 0 ? (
          <>
            <Button
              variant="secondary"
              disabled={working === "queue-posts" || Boolean(run.postsQueuedAt)}
              onClick={() => void startAgain(run.id, { action: "queue-posts" }, "queue-posts")}
              className={SMALL_BUTTON}
            >
              {working === "queue-posts" ? <Spinner /> : null}
              {run.postsQueuedAt ? "Threads posts scheduled" : "Schedule the Threads posts"}
            </Button>
            <button
              type="button"
              onClick={() => setPostsOpen((open) => !open)}
              className="text-xs font-medium text-[var(--accent)] transition hover:opacity-80"
            >
              {postsOpen ? "Hide posts" : `Show ${run.posts.length} posts`}
            </button>
          </>
        ) : null;
      case "schedule":
        if (!run || !schedulable) return null;
        if (run.queueFailures?.length) {
          return (
            <>
              {bookingFailure ? (
                <Button disabled={working === "plan"} onClick={() => void loadPlan(run.id)} className={SMALL_BUTTON}>
                  {working === "plan" ? <Spinner /> : null}
                  Book these now
                </Button>
              ) : (
                <Button
                  disabled={working === "queue-posts"}
                  onClick={() => void startAgain(run.id, { action: "queue-posts" }, "queue-posts")}
                  className={SMALL_BUTTON}
                >
                  {working === "queue-posts" ? <Spinner /> : null}
                  Schedule the Threads posts
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={working === "dismiss-failures"}
                onClick={() => void startAgain(run.id, { action: "dismiss-failures" }, "dismiss-failures")}
                className={SMALL_BUTTON}
              >
                {working === "dismiss-failures" ? <Spinner /> : null}
                Dismiss
              </Button>
            </>
          );
        }
        if (plan) return null;
        return (
          <Button disabled={working === "plan"} onClick={() => void loadPlan(run.id)} className={SMALL_BUTTON}>
            {working === "plan" ? <Spinner /> : <CalendarClock className="mr-1.5 h-3.5 w-3.5" />}
            Schedule everything
          </Button>
        );
      default:
        return null;
    }
  };

  const stageBody = (key: PipelineStageKey): React.ReactNode => {
    switch (key) {
      case "visuals":
        return active?.visualMoment && run?.sourceId ? (
          <VisualAdComposer sourceId={run.sourceId} streamName={run.name} moment={active.visualMoment} />
        ) : null;
      case "posts":
        return postsOpen && run?.posts?.length ? (
          <div className="mt-3 space-y-2">
            {run.posts.map((post) => (
              <div
                key={post.id}
                className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white/3 p-3"
              >
                <span className="mt-0.5 shrink-0 rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                  {POST_PLATFORM_LABELS[post.platform]}
                </span>
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-white/90">{post.text}</p>
                <CopyPostButton text={post.text} />
              </div>
            ))}
          </div>
        ) : null;
      case "schedule":
        if (!run || !schedulable) return null;
        return (
          <div className="mt-3 space-y-3">
            {run.queueFailures?.length ? (
              <p className="tone-warning tone-text text-xs">
                {run.queueFailures[0].error}
                {run.queueFailures[0].error.includes(PUBLISHING_OFF_MESSAGE) ? (
                  <>
                    {" "}
                    <Link href="/settings" className="underline">
                      Open Settings
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            {plan ? (
              <div className="rounded-lg border border-[var(--border)] bg-white/3 p-3">
                {plan.problem ? (
                  <p className="tone-warning tone-text text-xs">
                    {plan.problem}{" "}
                    <Link href="/settings" className="underline">
                      Open Settings
                    </Link>
                  </p>
                ) : plan.candidates.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Nothing here is waiting to be scheduled
                    {plan.skipped.length > 0 ? ` — ${plan.skipped.length} already are.` : "."}
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                      {plan.candidates.length} to schedule, one per free slot. Untick anything you would rather keep
                      back.
                    </p>
                    <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                      {plan.candidates.map((candidate) => (
                        <label key={candidate.id} className="flex items-start gap-2 text-xs text-white/90">
                          <input
                            type="checkbox"
                            checked={!dropped.includes(candidate.id)}
                            onChange={() =>
                              setDropped((current) =>
                                current.includes(candidate.id)
                                  ? current.filter((id) => id !== candidate.id)
                                  : [...current, candidate.id]
                              )
                            }
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="mr-1.5 rounded bg-white/8 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                              {candidate.kind === "clip" ? "short" : candidate.kind}
                            </span>
                            {candidate.title}
                            {candidate.imagePaths ? (
                              <span className="ml-1.5 text-[var(--muted-foreground)]">
                                {candidate.imagePaths.length} slides
                              </span>
                            ) : null}
                            {candidate.heldBack ? (
                              <span className="ml-1.5 text-[11px] text-[var(--muted-foreground)]">
                                {candidate.heldBack === "unticked"
                                  ? "— you held this back; tick it to book it"
                                  : "— booked before, then removed from the queue"}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    disabled={
                      working === "queue" || Boolean(plan.problem) || plan.candidates.length === dropped.length
                    }
                    onClick={() =>
                      void confirmQueue(
                        run.id,
                        plan.candidates.map((item) => item.id).filter((id) => !dropped.includes(id)),
                        plan.candidates.map((item) => item.id)
                      )
                    }
                    className={SMALL_BUTTON}
                  >
                    {working === "queue" ? <Spinner /> : null}
                    Schedule {plan.candidates.length - dropped.length} now
                  </Button>
                  <Button variant="secondary" onClick={() => setPlan(null)} className={SMALL_BUTTON}>
                    Cancel
                  </Button>
                  {plan.skipped.length > 0 ? (
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {plan.skipped.length} left out — {plan.skipped[0].reason.toLowerCase()}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {schedulable.carouselSlides > MAX_IMAGES_PER_POST ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                {schedulable.carouselSlides} slides is more than one post takes — the deck is split by hand in
                Carousels.
              </p>
            ) : null}
            {run.queueWhenReady ? (
              <div className="tone-success tone-edge tone-soft flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                <span className="tone-success tone-text min-w-0 flex-1 text-xs">
                  Anything still rendering is booked as it lands. Nothing you unticked will be.
                  {run.unattended ? " Its segments render and its Threads posts are scheduled too." : ""}
                </span>
                <Button
                  variant="secondary"
                  disabled={working === "stop-queueing"}
                  onClick={() => void startAgain(run.id, { action: "stop-queueing" }, "stop-queueing")}
                  className={cn(SMALL_BUTTON, "shrink-0")}
                >
                  {working === "stop-queueing" ? <Spinner /> : null}
                  Stop booking automatically
                </Button>
              </div>
            ) : null}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      {...dragProps}
      className={cn(
        "rounded-2xl border border-transparent transition",
        dragActive && "border-dashed border-[var(--accent)] bg-white/3"
      )}
    >
      <div className="pipeline-hero-enter mx-auto max-w-3xl">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={backToSearch}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
            title="Start a new stream"
            aria-label="Start a new stream"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight text-white">{run?.name ?? "Starting the pipeline..."}</h2>
            <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
              {run ? `${formatStartedAt(run.createdAt)} · ${describeOutputQuality(normalizeOutputQuality(run.output))}` : "Reading the stream"}
              {run?.sourceUrl || run?.fileName ? ` · ${run.sourceUrl ?? run.fileName}` : ""}
            </p>
          </div>
          {run ? (
            <button
              type="button"
              onClick={() => void deleteRun(run.id)}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-[var(--danger)]"
              aria-label={`Remove ${run.name}`}
              title="Remove this run"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {chips.length > 0 ? (
          <div className="mt-4">
            <OutputStrip chips={chips} />
          </div>
        ) : null}
      </div>

      <div className="mx-auto mt-6 max-w-3xl">
        {scanNotice}
        {!stages ? (
          loaded ? (
            <Card className="p-10 text-center text-sm text-[var(--muted-foreground)]">
              That run is gone. Go back and paste a stream link to start a new one.
            </Card>
          ) : null
        ) : (
          <>
            {run && active && active.retryable.length > 0 ? (
              <Card className="tone-warning tone-edge tone-soft mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
                <p className="tone-warning tone-text min-w-0 text-sm">
                  {active.retryable.length} stage{active.retryable.length === 1 ? "" : "s"} stopped short —{" "}
                  {active.retryable.map((item) => STAGE_TITLES[item.stage]).join(", ")}.
                </p>
                <Button
                  variant="secondary"
                  disabled={working === "retry-all"}
                  onClick={() => void startAgain(run.id, { action: "retry-all" }, "retry-all")}
                  className={cn(
                    SMALL_BUTTON,
                    "tone-warning tone-edge tone-text shrink-0 hover:border-[color-mix(in_srgb,var(--warning)_60%,transparent)]"
                  )}
                >
                  {working === "retry-all" ? <Spinner /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                  Try them all again
                </Button>
              </Card>
            ) : null}
            {run?.notices?.map((notice) => (
              <p key={notice} className="tone-warning tone-text mb-2 text-xs">
                {notice}
              </p>
            ))}
            {STAGE_ORDER.map((key, index) => {
              const next = STAGE_ORDER[index + 1];
              // The server decides what can be run again; the row only draws it.
              const repairable = active?.retryable.some((item) => item.stage === key);
              return (
                <StageRow
                  key={key}
                  stageKey={key}
                  stage={stages[key]}
                  index={index}
                  last={index === STAGE_ORDER.length - 1}
                  flowing={Boolean(next && stages[next].status === "running")}
                  onRetry={repairable && run ? () => void startAgain(run.id, { stage: key }, key) : undefined}
                  retrying={working === key}
                  action={stageAction(key)}
                >
                  {stageBody(key)}
                </StageRow>
              );
            })}
          </>
        )}
        {runList(true)}
      </div>
      {fileInput}
    </div>
  );
}
