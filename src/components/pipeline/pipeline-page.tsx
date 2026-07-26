"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AtSign,
  CalendarClock,
  Check,
  Clapperboard,
  Copy,
  Download,
  Images,
  Link as LinkIcon,
  Loader2,
  Podcast,
  Scissors,
  Trash2,
  Upload,
  UploadCloud,
  type LucideIcon
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  PipelinePost,
  PipelineRun,
  PipelineRunOverview,
  PipelineStage,
  PipelineStageKey,
  PipelineStageStatus
} from "@/lib/pipeline/types";

/** Top-to-bottom order of the flow — drives the reveal and the live counter. */
const STAGE_ORDER: PipelineStageKey[] = ["source", "longform", "clips", "audio", "images", "posts", "schedule"];

/** How far the run has got, for the progress strip that sits above the flow. */
function runProgress(stages: Record<PipelineStageKey, PipelineStage>) {
  const list = STAGE_ORDER.map((key) => stages[key]);
  const done = list.filter((stage) => stage.status === "ready" || stage.status === "skipped").length;
  const runningKey = STAGE_ORDER.find((key) => stages[key].status === "running");
  return {
    done,
    total: list.length,
    percent: Math.round((done / list.length) * 100),
    running: runningKey ? stages[runningKey] : null,
    failed: list.some((stage) => stage.status === "error")
  };
}

/** The formats one run fans out into — the hero's promise, before any run exists. */
const OUTPUT_NAMES = ["Long-form edit", "Short clips", "Podcast MP3", "Carousel images", "Text posts"];

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

/** One node in the top-to-bottom flow: icon on the rail, card to the right. */
function StageRow({
  icon: Icon,
  title,
  stage,
  index = 0,
  last = false,
  children
}: {
  icon: LucideIcon;
  title: string;
  stage: PipelineStage;
  /** Position in the flow — staggers the reveal so the pipeline unrolls. */
  index?: number;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const active = stage.status === "running";
  const done = stage.status === "ready";
  return (
    <div className="panel-enter flex gap-4" style={{ animationDelay: `${index * 70}ms` }}>
      {/* Rail: the node plus the connector running down to the next stage. */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
            done
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : active
                ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                : stage.status === "error"
                  ? "border-red-400/40 bg-red-400/10 text-red-300"
                  : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted-foreground)]"
          )}
        >
          <Icon className="h-4.5 w-4.5" />
          {/* A halo on whatever is working right now, so the eye finds the
              live edge of the run without reading any labels. */}
          {active && (
            <span className="absolute h-10 w-10 animate-ping rounded-full border border-sky-400/40" aria-hidden />
          )}
        </div>
        {!last && <div className={cn("w-px flex-1", done ? "bg-emerald-400/30" : "bg-[var(--border)]")} />}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <Card className="p-4">
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

/**
 * The composer — the one control the whole app hangs off.
 *
 * In `hero` size it is the centred introduction: a big rounded box you type a
 * link into, with the actions on their own row underneath, the way ChatGPT and
 * Claude open. In `docked` size it is the same control shrunk to a single line
 * above a running pipeline, so starting the next run never means going
 * somewhere else. Both accept a dropped video anywhere on the box.
 */
function Composer({
  size,
  url,
  onUrlChange,
  onSubmit,
  onPickFile,
  onDropFile,
  busy,
  submitting,
  uploading
}: {
  size: "hero" | "docked";
  url: string;
  onUrlChange: (value: string) => void;
  onSubmit: () => void;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
  busy: boolean;
  submitting: boolean;
  uploading: boolean;
}) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const hero = size === "hero";

  const handleDrop = (event: React.DragEvent) => {
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
    onDropFile(file);
  };

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className={cn(
        "w-full border bg-[var(--panel)] transition-all duration-300 ease-ios",
        hero ? "rounded-3xl p-3 shadow-2xl" : "rounded-2xl p-2",
        dragActive
          ? "border-[var(--accent)] bg-white/5 ring-4 ring-[var(--accent)]/15"
          : "border-[var(--border-strong)] hover:border-[var(--accent)]/50"
      )}
    >
      <div className={cn("flex gap-2", hero ? "flex-col" : "items-center")}>
        <div className="relative flex-1">
          <LinkIcon
            className={cn(
              "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]",
              hero ? "h-5 w-5" : "h-4 w-4"
            )}
          />
          <input
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
            }}
            placeholder={hero ? "Paste a stream or VOD link…" : "Paste another stream or VOD link…"}
            disabled={busy}
            aria-label="Stream or VOD link"
            className={cn(
              "w-full bg-transparent pl-12 pr-3 text-white outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60",
              hero ? "py-4 text-lg" : "py-2 text-sm"
            )}
          />
        </div>

        <div className={cn("flex items-center gap-2", hero && "justify-between px-1 pb-1")}>
          {hero && (
            <p className="hidden text-xs text-[var(--muted-foreground)] sm:block">
              …or drop a recording anywhere on this box.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onPickFile} disabled={busy} className={cn(!hero && "px-3 py-1.5 text-xs")}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload
            </Button>
            <Button onClick={onSubmit} disabled={busy || !url.trim()} className={cn(!hero && "px-3 py-1.5 text-xs")}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Run pipeline
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The live band above the flow: how many stages are done, what is working right
 * now, and a bar that fills as the run generates each format. This is the part
 * you watch while a pipeline runs.
 */
function RunProgress({ stages, name }: { stages: Record<PipelineStageKey, PipelineStage>; name: string }) {
  const { done, total, percent, running, failed } = runProgress(stages);
  const complete = done === total;
  return (
    <div className="panel-enter rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {running ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-300" />
          ) : failed ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
          ) : (
            <Check className="h-4 w-4 shrink-0 text-emerald-300" />
          )}
          <p className="truncate text-sm font-medium text-white">{name}</p>
        </div>
        <p className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
          {running ? (
            <>
              <span className="text-sky-300">{running.detail}</span> · {done} of {total} done
            </>
          ) : complete ? (
            <span className="text-emerald-300">All {total} stages complete</span>
          ) : (
            <>
              {done} of {total} done
            </>
          )}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-ios",
            complete ? "bg-emerald-400" : "bg-[var(--accent)]"
          )}
          style={{ width: `${Math.max(percent, running ? 6 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function PipelinePage() {
  const [overviews, setOverviews] = useState<PipelineRunOverview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [postsOpen, setPostsOpen] = useState(false);
  // "Start another one" puts the hero back even though runs already exist —
  // the same way a new chat clears the thread but keeps the history.
  const [composing, setComposing] = useState(false);

  const active = useMemo(
    () => overviews.find((entry) => entry.run.id === activeRunId) ?? overviews[0] ?? null,
    [activeRunId, overviews]
  );

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
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as { run?: PipelineRun; error?: string };
      if (response.ok && data.run) {
        setActiveRunId(data.run.id);
        setUrl("");
        // Leaving the hero is what reveals the flow — the run takes the page.
        setComposing(false);
        toast.success("Pipeline started. Everything runs from here.");
        void refresh();
      } else {
        toast.error(data.error ?? "Could not start the pipeline.");
      }
    },
    [refresh]
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
      toast.error("Request failed. Is the dev server still running?");
    } finally {
      setSubmitting(false);
    }
  }, [startRun, url]);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const response = await fetch(`/api/clips/sources?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "video/mp4" },
          body: file
        });
        const data = (await response.json()) as { source?: { id: string }; error?: string };
        if (!response.ok || !data.source) {
          toast.error(data.error ?? "Upload failed.");
          return;
        }
        await startRun({ sourceId: data.source.id });
      } catch {
        toast.error("Upload failed. Is the dev server still running?");
      } finally {
        setUploading(false);
      }
    },
    [startRun]
  );

  const deleteRun = useCallback(
    async (runId: string) => {
      try {
        const response = await fetch(`/api/pipeline/${runId}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        setOverviews((prev) => prev.filter((entry) => entry.run.id !== runId));
        if (activeRunId === runId) setActiveRunId(null);
        toast.success("Run removed. Its outputs stay in their own tools.");
      } catch {
        toast.error("Could not remove the run.");
      }
    },
    [activeRunId]
  );

  const run = active?.run;
  const stages = active?.stages;
  const schedulable = active?.schedulable;
  const longformHref = run?.longformProjectId ? `/longform?open=${run.longformProjectId}` : "/longform";
  const audioHref =
    run?.longformProjectId && run.longformExportId
      ? `/api/longform/projects/${run.longformProjectId}/export/${run.longformExportId}/audio?download=1`
      : null;

  const busy = submitting || uploading;
  // The hero owns the page until a run does: on a first visit, and whenever
  // "Start another one" is pressed.
  const showHero = loaded && (composing || !active);

  const composer = (
    <Composer
      size={showHero ? "hero" : "docked"}
      url={url}
      onUrlChange={setUrl}
      onSubmit={() => void submitUrl()}
      onPickFile={() => uploadInputRef.current?.click()}
      onDropFile={(file) => void uploadFile(file)}
      busy={busy}
      submitting={submitting}
      uploading={uploading}
    />
  );

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

  // ---- The introduction: nothing but the bar, until there is a run to show.
  if (showHero) {
    return (
      <div className="page-enter flex min-h-[76vh] flex-col items-center justify-center px-2">
        <div className="w-full max-w-2xl text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">
            Content pipeline
          </p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            What are we turning into content?
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-pretty text-[var(--muted-foreground)]">
            Paste a stream or drop a recording. Everything else builds itself, and you watch it happen.
          </p>

          <div className="mt-8">{composer}</div>

          {/* The promise, in the order the run produces them. */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {OUTPUT_NAMES.map((name) => (
              <span
                key={name}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)]"
              >
                {name}
              </span>
            ))}
          </div>

          {overviews.length > 0 && (
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="mt-8 text-sm text-[var(--muted-foreground)] transition hover:text-white"
            >
              ← Back to {overviews.length === 1 ? "your run" : `your ${overviews.length} runs`}
            </button>
          )}
        </div>
        {fileInput}
      </div>
    );
  }

  return (
    <div>
      {/* Docked composer — start the next run without leaving the flow. */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">{composer}</div>
        <Button
          variant="secondary"
          onClick={() => {
            setComposing(true);
            setUrl("");
          }}
          className="shrink-0 px-3 py-2 text-xs"
        >
          Start another one
        </Button>
      </div>
      {fileInput}

      {/* Run history chips. */}
      {overviews.length > 0 && (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
          {overviews.map((entry) => {
            const isActive = entry.run.id === (run?.id ?? "");
            return (
              <button
                key={entry.run.id}
                type="button"
                onClick={() => setActiveRunId(entry.run.id)}
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
                    entry.run.status === "error" ? "bg-red-400" : entry.settled ? "bg-emerald-400" : "bg-sky-400 animate-pulse"
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
      )}

      {/* The flow itself: source at the top, scheduler at the bottom. Keyed by
          run id so switching runs replays the reveal from the top. */}
      {!run || !stages ? null : (
        <div key={run.id} className="mt-6 lg:max-w-3xl">
          <RunProgress stages={stages} name={run.name} />

          <div className="mt-6">
            <StageRow icon={UploadCloud} title="Stream source" stage={stages.source} index={0} />

          <StageRow icon={Clapperboard} title="Long-form edit" stage={stages.longform} index={1}>
            <div className="mt-3">
              <Link href={longformHref}>
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Open in Long-Form Editor
                </Button>
              </Link>
            </div>
          </StageRow>

          <StageRow icon={Scissors} title="Short-form clips" stage={stages.clips} index={2}>
            <div className="mt-3">
              <Link href="/clips">
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Open in Clip Generator
                </Button>
              </Link>
            </div>
          </StageRow>

          <StageRow icon={Podcast} title="Podcast MP3" stage={stages.audio} index={3}>
            {stages.audio.status === "ready" && audioHref && (
              <div className="mt-3">
                <a href={audioHref}>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs">
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download MP3
                  </Button>
                </a>
              </div>
            )}
          </StageRow>

          <StageRow icon={Images} title="Carousel images" stage={stages.images} index={4}>
            {run.carouselId && (
              <div className="mt-3">
                <Link href="/carousels">
                  <Button variant="secondary" className="px-3 py-1.5 text-xs">
                    Open in Carousels
                  </Button>
                </Link>
              </div>
            )}
          </StageRow>

          <StageRow icon={AtSign} title="Text-only posts" stage={stages.posts} index={5}>
            {run.posts && run.posts.length > 0 && (
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
            )}
          </StageRow>

          <StageRow icon={CalendarClock} title="Scheduler" stage={stages.schedule} index={6} last>
            {schedulable && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                  <span>{schedulable.clipsReady} shorts</span>
                  <span>{schedulable.longformReady ? "1 long-form video" : "long-form pending"}</span>
                  <span>{schedulable.audioReady ? "1 MP3" : "MP3 pending"}</span>
                  <span>{schedulable.carouselSlides > 0 ? `${schedulable.carouselSlides} slides` : "slides pending"}</span>
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
            )}
          </StageRow>
          </div>
        </div>
      )}
    </div>
  );
}
