"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
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
import { runListStatus, type RunTone } from "@/lib/pipeline/status";
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
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  error: "border-red-400/30 bg-red-400/10 text-red-300",
  running: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  waiting: "border-white/10 bg-white/5 text-[var(--muted-foreground)]",
  skipped: "border-amber-400/30 bg-amber-400/10 text-amber-300"
};

const STATUS_LABELS: Record<PipelineStageStatus, string> = {
  ready: "Ready",
  error: "Needs attention",
  running: "Working",
  waiting: "Waiting",
  skipped: "Skipped"
};

// What each stage is called wherever it is named — the row heading and the
// "these stopped short" summary must say the same word for the same thing.
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

const RUN_TONE_DOT: Record<RunTone, string> = {
  attention: "bg-amber-400",
  working: "bg-sky-400 animate-pulse",
  done: "bg-emerald-400"
};

const RUN_TONE_TEXT: Record<RunTone, string> = {
  attention: "text-amber-300/90",
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
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * The one control the app opens on: a single pill that takes a link, a click to
 * upload, or a dropped file. `compact` is the version that stays pinned above a
 * running flow.
 */
function StreamSearchBar({
  value,
  onChange,
  onSubmit,
  onPickFile,
  busy,
  compact = false
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onPickFile: () => void;
  busy: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] transition focus-within:border-[var(--accent)]",
        compact
          ? "px-2 py-1.5 shadow-[0_1px_8px_rgba(0,0,0,0.25)]"
          : "px-3 py-2.5 shadow-[0_8px_40px_rgba(0,0,0,0.35)] focus-within:shadow-[0_8px_44px_color-mix(in_srgb,var(--accent)_18%,transparent)]"
      )}
    >
      <button
        type="button"
        onClick={onPickFile}
        disabled={busy}
        aria-label="Upload a video file"
        title="Upload a video file"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition hover:bg-white/8 hover:text-white disabled:opacity-40",
          compact ? "h-8 w-8" : "h-10 w-10"
        )}
      >
        <Plus className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
        }}
        disabled={busy}
        placeholder={compact ? "Run another stream..." : "Paste a stream or VOD link"}
        aria-label="Stream or VOD link"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60",
          compact ? "h-8 text-sm" : "h-10 text-base"
        )}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || !value.trim()}
        aria-label="Run the pipeline"
        title="Run the pipeline"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] transition hover:opacity-90 disabled:bg-white/10 disabled:text-[var(--muted-foreground)]",
          compact ? "h-8 w-8" : "h-10 w-10"
        )}
      >
        {busy ? (
          <Loader2 className={cn("animate-spin", compact ? "h-4 w-4" : "h-4.5 w-4.5")} />
        ) : (
          <ArrowUp className={compact ? "h-4 w-4" : "h-5 w-5"} />
        )}
      </button>
    </div>
  );
}

/** One node in the top-to-bottom flow: icon on the rail, card to the right. */
function StageRow({
  icon: Icon,
  title,
  stage,
  index,
  last = false,
  flowing = false,
  onRetry,
  retrying = false,
  children
}: {
  icon: LucideIcon;
  title: string;
  stage: PipelineStage;
  index: number;
  last?: boolean;
  flowing?: boolean;
  /** Present only when this stage can be run again — see `retryable`. */
  onRetry?: () => void;
  retrying?: boolean;
  children?: React.ReactNode;
}) {
  const active = stage.status === "running";
  const done = stage.status === "ready";
  return (
    <div className="animate-in flex gap-4" style={{ animationDelay: `${index * 70}ms` }}>
      {/* Rail: the node plus the connector running down to the next stage. */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
            done
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : active
                ? "pipeline-node-live border-sky-400/40 bg-sky-400/10 text-sky-300"
                : stage.status === "error"
                  ? "border-red-400/40 bg-red-400/10 text-red-300"
                  : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted-foreground)]"
          )}
        >
          <Icon className="h-4.5 w-4.5" />
          {active && (
            <span className="pipeline-orbit pointer-events-none absolute -inset-1 rounded-full border border-transparent border-t-sky-300/70" />
          )}
        </div>
        {!last && (
          <div
            className={cn(
              "w-px flex-1",
              flowing ? "pipeline-rail-live bg-[var(--border)]" : done ? "bg-emerald-400/30" : "bg-[var(--border)]"
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <Card className={cn("p-4", active && "pipeline-card-live border-sky-400/25")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <StatusChip status={stage.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{stage.detail}</p>
          {stage.status === "running" && typeof stage.progress === "number" && (
            <Progress value={stage.progress} className="mt-3" />
          )}
          {/* A stage that failed or gave up is one click from running again —
              the same repair the command bar performs, on the row that broke. */}
          {onRetry && (
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={onRetry}
                disabled={retrying}
                className="border-amber-400/30 px-3 py-1.5 text-xs text-amber-200 hover:border-amber-400/50"
              >
                {retrying ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Try this again
              </Button>
            </div>
          )}
          {children}
        </Card>
      </div>
    </div>
  );
}

export function PipelinePage() {
  // ?run=<id> is how the command bar opens one run: "pull up the Day 13 run"
  // has to land on that run, not on the list with it buried in it.
  const requestedRunId = useSearchParams().get("run");
  const [overviews, setOverviews] = useState<PipelineRunOverview[]>([]);
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
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [postsOpen, setPostsOpen] = useState(false);

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
      const data = (await response.json()) as { runs: PipelineRunOverview[] };
      setOverviews(data.runs);
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
    async (body: { url?: string; sourceId?: string }) => {
      setShowFlow(true);
      setLaunching(true);
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as { run?: PipelineRun; error?: string };
      if (response.ok && data.run) {
        setActiveRunId(data.run.id);
        setPostsOpen(false);
        setUrl("");
        toast.success("Pipeline started. Everything runs from here.");
        await refresh();
        setLaunching(false);
      } else {
        setLaunching(false);
        setShowFlow(overviews.length > 0);
        toast.error(data.error ?? "Could not start the pipeline.");
      }
    },
    [overviews.length, refresh]
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
        const data = (await response.json()) as { source?: { id: string }; error?: string };
        if (!response.ok || !data.source) {
          setLaunching(false);
          toast.error(data.error ?? "Upload failed.");
          return;
        }
        await startRun({ sourceId: data.source.id });
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
        if (activeRunId === runId) {
          setActiveRunId(null);
          setShowFlow(false);
        }
        toast.success("Run removed. Its outputs stay in their own tools.");
      } catch {
        toast.error("Could not remove the run.");
      }
    },
    [activeRunId, overviews]
  );

  /**
   * The one place a stuck stage gets started again — the same repairs the
   * command bar calls, so the button and the sentence agree. The reply carries
   * the fresh overview, so the row updates now instead of on the next poll.
   */
  const startAgain = useCallback(
    async (runId: string, body: { stage: string } | { action: "segment" | "retry-all" }, pendingKey: string) => {
      setWorking(pendingKey);
      try {
        const response = await fetch(`/api/pipeline/${runId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = (await response.json()) as { detail?: string; error?: string; overview?: PipelineRunOverview };
        if (!response.ok || !data.overview) {
          toast.error(data.error ?? "That could not be started again.");
          return;
        }
        setOverviews((current) =>
          current.map((entry) => (entry.run.id === runId ? data.overview! : entry))
        );
        toast.success(data.detail ?? "Started again.");
      } catch {
        toast.error("Request failed. Is the server still running?");
      } finally {
        setWorking(null);
      }
    },
    []
  );

  // Opening a run scrolls back to the top of the page, not to the flow: the
  // picker stays in view, so it is obvious WHICH run is now open.
  const openRun = useCallback((runId: string) => {
    setActiveRunId(runId);
    setPostsOpen(false);
    setShowFlow(true);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }, []);

  const backToSearch = useCallback(() => {
    setShowFlow(false);
    setLaunching(false);
    setActiveRunId(null);
    setUrl("");
  }, []);

  const run = active?.run;
  const stages = active?.stages ?? (launching ? LAUNCHING_STAGES : null);
  const schedulable = active?.schedulable;
  // A count of zero means one of two very different things. "segments pending"
  // next to a Skipped segments stage read as a contradiction — a stage that
  // gave up is never going to deliver anything.
  const pendingLabel = (key: PipelineStageKey, noun: string) =>
    stages?.[key].status === "skipped" || stages?.[key].status === "error" ? `no ${noun}` : `${noun} pending`;
  const longformHref = run?.longformProjectId ? `/longform?open=${run.longformProjectId}` : "/longform";
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

  // The opening screen stays close to bare, so it only offers the handful of
  // most recent runs; the full, scrollable list lives above a running flow.
  // Names are shown in FULL and stamped with when the run started — a channel
  // posts the same series week after week, so four runs can share a title and
  // a truncated pill leaves nothing to tell them apart by.
  const runList = (compact = false) => {
    const listed = compact ? overviews : overviews.slice(0, 6);
    return listed.length === 0 ? null : (
      <div className={compact ? "mt-4" : "mt-8"}>
        <p className="pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          Earlier pipelines
        </p>
        <div
          className={cn(
            "grid gap-2 sm:grid-cols-2",
            compact && overviews.length > 4 && "max-h-64 overflow-y-auto pr-1"
          )}
        >
          {listed.map((entry) => {
            const isActive = showFlow && entry.run.id === (run?.id ?? "");
            const status = runListStatus(entry);
            return (
              <div
                key={entry.run.id}
                className={cn(
                  "group flex items-start gap-2 rounded-xl border px-3 py-2 transition",
                  isActive
                    ? "border-[var(--accent)] bg-white/8"
                    : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-white/4"
                )}
              >
                <button
                  type="button"
                  onClick={() => openRun(entry.run.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  title={`Open ${entry.run.name}`}
                >
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", RUN_TONE_DOT[status.tone])} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block break-words text-xs font-medium",
                        isActive ? "text-white" : "text-white/90"
                      )}
                    >
                      {entry.run.name}
                    </span>
                    <span className={cn("mt-0.5 block text-[11px]", RUN_TONE_TEXT[status.tone])}>
                      {status.label} · {formatStartedAt(entry.run.createdAt)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRun(entry.run.id)}
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
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
          <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
            One stream in — long-form edit, shorts, MP3, carousel, and posts come back out.
          </p>
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

  const rows: Array<{
    key: PipelineStageKey;
    icon: LucideIcon;
    title: string;
    children?: React.ReactNode;
  }> = [
    { key: "source", icon: UploadCloud, title: STAGE_TITLES.source },
    {
      key: "longform",
      icon: Clapperboard,
      title: STAGE_TITLES.longform,
      children: (
        <div className="mt-3">
          <Link href={longformHref}>
            <Button variant="secondary" className="px-3 py-1.5 text-xs">
              Open in Long-Form Editor
            </Button>
          </Link>
        </div>
      )
    },
    {
      key: "segments",
      icon: Layers,
      title: STAGE_TITLES.segments,
      // Segments are planned automatically and rendered on demand, one at a
      // time. The button used to be a link to the editor — it now renders.
      children: (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {run && segmentsPending > 0 ? (
            <Button
              variant="secondary"
              disabled={working === "segment"}
              onClick={() => void startAgain(run.id, { action: "segment" }, "segment")}
              className="px-3 py-1.5 text-xs"
            >
              {working === "segment" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="mr-1.5 h-3.5 w-3.5" />
              )}
              Render next segment
            </Button>
          ) : null}
          <Link href={longformHref}>
            <Button variant="secondary" className="px-3 py-1.5 text-xs">
              Open in Long-Form Editor
            </Button>
          </Link>
          {schedulable && schedulable.segments > 0 ? (
            <span className="text-xs text-[var(--muted-foreground)]">
              {schedulable.segmentsRendered} of {schedulable.segments} rendered
            </span>
          ) : null}
        </div>
      )
    },
    {
      key: "clips",
      icon: Scissors,
      title: STAGE_TITLES.clips,
      children: (
        <div className="mt-3">
          <Link href="/clips">
            <Button variant="secondary" className="px-3 py-1.5 text-xs">
              Open in Clip Generator
            </Button>
          </Link>
        </div>
      )
    },
    {
      key: "audio",
      icon: Podcast,
      title: STAGE_TITLES.audio,
      children:
        stages?.audio.status === "ready" && audioHref ? (
          <div className="mt-3">
            <a href={audioHref}>
              <Button variant="secondary" className="px-3 py-1.5 text-xs">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download MP3
              </Button>
            </a>
          </div>
        ) : null
    },
    {
      key: "podcast",
      icon: Radio,
      title: STAGE_TITLES.podcast,
      children: (
        <div className="mt-3">
          <Link href="/podcast">
            <Button variant="secondary" className="px-3 py-1.5 text-xs">
              Open the podcast feed
            </Button>
          </Link>
        </div>
      )
    },
    {
      key: "images",
      icon: Images,
      title: STAGE_TITLES.images,
      children:
        run?.carouselId || run?.longformProjectId ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {run?.carouselId ? (
              <Link href="/carousels">
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Open in Carousels
                </Button>
              </Link>
            ) : null}
            {/* The unattended stage writes one text-only carousel. More batches,
                or photos on the slides, are a person's call — this lands on the
                Carousels page with this stream already picked. */}
            {run?.longformProjectId ? (
              <Link href={`/carousels?longform=${run.longformProjectId}`}>
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Add photos / more batches
                </Button>
              </Link>
            ) : null}
          </div>
        ) : null
    },
    {
      key: "visuals",
      icon: Sparkles,
      title: STAGE_TITLES.visuals,
      children:
        active?.visualMoment && run?.sourceId ? (
          <VisualAdComposer sourceId={run.sourceId} streamName={run.name} moment={active.visualMoment} />
        ) : null
    },
    {
      key: "posts",
      icon: AtSign,
      title: STAGE_TITLES.posts,
      children:
        run?.posts && run.posts.length > 0 ? (
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => setPostsOpen((open) => !open)}
              className="text-xs font-medium text-[var(--accent)] transition hover:opacity-80"
            >
              {postsOpen ? "Hide posts" : `Show ${run.posts.length} posts`}
            </button>
            {postsOpen &&
              run.posts.map((post) => (
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
        ) : null
    },
    {
      key: "schedule",
      icon: CalendarClock,
      title: STAGE_TITLES.schedule,
      children: schedulable ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
            <span>{schedulable.clipsReady} shorts</span>
            <span>{schedulable.longformReady ? "1 long-form video" : pendingLabel("longform", "long-form")}</span>
            <span>
              {schedulable.segments > 0 ? `${schedulable.segments} topic segments` : pendingLabel("segments", "segments")}
            </span>
            <span>{schedulable.audioReady ? "1 MP3" : pendingLabel("audio", "MP3")}</span>
            <span className={schedulable.podcastPublished ? "text-emerald-300" : undefined}>
              {schedulable.podcastPublished ? "podcast episode published" : pendingLabel("podcast", "Spotify episode")}
            </span>
            <span>
              {schedulable.carouselSlides > 0 ? `${schedulable.carouselSlides} slides` : pendingLabel("images", "slides")}
            </span>
            <span>{schedulable.visualAdReady ? "visual ad ready" : pendingLabel("visuals", "visual ad")}</span>
            <span>{schedulable.posts} posts</span>
            {schedulable.queued > 0 && <span className="text-emerald-300">{schedulable.queued} queued</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/uploading-center">
              <Button className="px-3 py-1.5 text-xs">Schedule in Uploading Center</Button>
            </Link>
            <Link href="/master-calendar">
              <Button variant="secondary" className="px-3 py-1.5 text-xs">
                Master Calendar
              </Button>
            </Link>
          </div>
        </div>
      ) : null
    }
  ];

  return (
    <div
      {...dragProps}
      className={cn(
        "rounded-2xl border border-transparent transition",
        dragActive && "border-dashed border-[var(--accent)] bg-white/3"
      )}
    >
      <div className="pipeline-hero-enter mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={backToSearch}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
            title="Start a new stream"
          >
            <Sparkles className="h-3.5 w-3.5" />
            New stream
          </button>
          <div className="min-w-0 flex-1">
            <StreamSearchBar
              value={url}
              onChange={setUrl}
              onSubmit={() => void submitUrl()}
              onPickFile={() => uploadInputRef.current?.click()}
              busy={busy}
              compact
            />
          </div>
        </div>
        {runList(true)}
      </div>

      <div className="mx-auto mt-6 max-w-3xl">
        {!stages ? (
          loaded ? (
            <Card className="p-10 text-center text-sm text-[var(--muted-foreground)]">
              That run is gone. Paste a stream link above to start a new one.
            </Card>
          ) : null
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold text-white">{run?.name ?? "Starting the pipeline..."}</h2>
              <span className="text-xs text-[var(--muted-foreground)]">
                {run?.sourceUrl ?? run?.fileName ?? "Reading the stream"}
              </span>
            </div>
            {/* Everything that broke, and one button that starts all of it
                again — a run that failed in three places is one click, not a
                hunt down the flow for which rows went amber. */}
            {run && active && active.retryable.length > 0 ? (
              <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-400/25 bg-amber-400/[0.06] p-3">
                <p className="min-w-0 text-sm text-amber-100/90">
                  {active.retryable.length} stage{active.retryable.length === 1 ? "" : "s"} stopped short —{" "}
                  {active.retryable.map((item) => STAGE_TITLES[item.stage]).join(", ")}.
                </p>
                <Button
                  variant="secondary"
                  disabled={working === "retry-all"}
                  onClick={() => void startAgain(run.id, { action: "retry-all" }, "retry-all")}
                  className="shrink-0 border-amber-400/30 px-3 py-1.5 text-xs text-amber-100 hover:border-amber-400/60"
                >
                  {working === "retry-all" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Try them all again
                </Button>
              </Card>
            ) : null}
            {run?.notices?.map((notice) => (
              <p key={notice} className="mb-2 text-xs text-amber-300/90">
                {notice}
              </p>
            ))}
            {rows.map((row, index) => {
              const next = rows[index + 1];
              // The server decides what can be run again; the row only draws it.
              const repairable = active?.retryable.some((item) => item.stage === row.key);
              return (
                <StageRow
                  key={row.key}
                  icon={row.icon}
                  title={row.title}
                  stage={stages[row.key]}
                  index={index}
                  last={index === rows.length - 1}
                  flowing={Boolean(next && stages[next.key].status === "running")}
                  onRetry={
                    repairable && run ? () => void startAgain(run.id, { stage: row.key }, row.key) : undefined
                  }
                  retrying={working === row.key}
                >
                  {row.children}
                </StageRow>
              );
            })}
          </>
        )}
      </div>
      {fileInput}
    </div>
  );
}
