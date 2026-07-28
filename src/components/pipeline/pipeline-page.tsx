"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  AtSign,
  CalendarClock,
  Check,
  Clapperboard,
  Copy,
  Download,
  Images,
  Loader2,
  Plus,
  Podcast,
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
  clips: { status: "waiting", detail: "Waiting for the source." },
  audio: { status: "waiting", detail: "Waiting for the long-form export." },
  images: { status: "waiting", detail: "Waiting for the transcript." },
  visuals: { status: "waiting", detail: "Waiting for a moment worth shooting." },
  posts: { status: "waiting", detail: "Waiting for the transcript." },
  schedule: { status: "waiting", detail: "Waiting for the first output." }
};

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
  children
}: {
  icon: LucideIcon;
  title: string;
  stage: PipelineStage;
  index: number;
  last?: boolean;
  flowing?: boolean;
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
          {children}
        </Card>
      </div>
    </div>
  );
}

export function PipelinePage() {
  const [overviews, setOverviews] = useState<PipelineRunOverview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // The app opens on the bare search bar; the flow only exists once a stream has
  // been sent through it (or a past run is picked up again).
  const [showFlow, setShowFlow] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
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
        if (activeRunId === runId) {
          setActiveRunId(null);
          if (remaining.length === 0) setShowFlow(false);
        }
        toast.success("Run removed. Its outputs stay in their own tools.");
      } catch {
        toast.error("Could not remove the run.");
      }
    },
    [activeRunId, overviews]
  );

  const openRun = useCallback((runId: string) => {
    setActiveRunId(runId);
    setPostsOpen(false);
    setShowFlow(true);
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
  const longformHref = run?.longformProjectId ? `/longform?open=${run.longformProjectId}` : "/longform";
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
  const runChips = (compact = false) => {
    const listed = compact ? overviews : overviews.slice(0, 4);
    return listed.length === 0 ? null : (
      <div
        className={cn(
          "flex items-center gap-2 pb-1",
          compact ? "mt-4 overflow-x-auto" : "mt-8 flex-wrap justify-center"
        )}
      >
        {listed.map((entry) => {
          const isActive = showFlow && entry.run.id === (run?.id ?? "");
          return (
            <button
              key={entry.run.id}
              type="button"
              onClick={() => openRun(entry.run.id)}
              className={cn(
                "group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
                isActive
                  ? "border-[var(--accent)] bg-white/8 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)] hover:text-white"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  entry.run.status === "error"
                    ? "bg-red-400"
                    : entry.settled
                      ? "bg-emerald-400"
                      : "bg-sky-400 animate-pulse"
                )}
              />
              <span className="max-w-48 truncate">{entry.run.name}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteRun(entry.run.id);
                }}
                className="hidden text-[var(--muted-foreground)] transition hover:text-red-300 group-hover:block"
                aria-label="Remove run"
                title="Remove run"
              >
                <Trash2 className="h-3 w-3" />
              </span>
            </button>
          );
        })}
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
          {loaded && runChips()}
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
    { key: "source", icon: UploadCloud, title: "Stream source" },
    {
      key: "longform",
      icon: Clapperboard,
      title: "Long-form edit",
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
      key: "clips",
      icon: Scissors,
      title: "Short-form clips",
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
      title: "Podcast MP3",
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
      key: "images",
      icon: Images,
      title: "Carousel images",
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
      title: "Realistic visual ads",
      children:
        active?.visualMoment && run?.sourceId ? (
          <VisualAdComposer sourceId={run.sourceId} streamName={run.name} moment={active.visualMoment} />
        ) : null
    },
    {
      key: "posts",
      icon: AtSign,
      title: "Text-only posts",
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
      title: "Scheduler",
      children: schedulable ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
            <span>{schedulable.clipsReady} shorts</span>
            <span>{schedulable.longformReady ? "1 long-form video" : "long-form pending"}</span>
            <span>{schedulable.audioReady ? "1 MP3" : "MP3 pending"}</span>
            <span>{schedulable.carouselSlides > 0 ? `${schedulable.carouselSlides} slides` : "slides pending"}</span>
            <span>{schedulable.visualAdReady ? "visual ad ready" : "visual ad pending"}</span>
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
        {runChips(true)}
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
            {run?.notices?.map((notice) => (
              <p key={notice} className="mb-2 text-xs text-amber-300/90">
                {notice}
              </p>
            ))}
            {rows.map((row, index) => {
              const next = rows[index + 1];
              return (
                <StageRow
                  key={row.key}
                  icon={row.icon}
                  title={row.title}
                  stage={stages[row.key]}
                  index={index}
                  last={index === rows.length - 1}
                  flowing={Boolean(next && stages[next.key].status === "running")}
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
