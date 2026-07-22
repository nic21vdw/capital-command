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
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  PipelinePost,
  PipelineRun,
  PipelineRunOverview,
  PipelineStage,
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
  last = false,
  children
}: {
  icon: LucideIcon;
  title: string;
  stage: PipelineStage;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const active = stage.status === "running";
  const done = stage.status === "ready";
  return (
    <div className="flex gap-4">
      {/* Rail: the node plus the connector running down to the next stage. */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
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

export function PipelinePage() {
  const [overviews, setOverviews] = useState<PipelineRunOverview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [postsOpen, setPostsOpen] = useState(false);

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

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (submitting || uploading) return;
      const file = Array.from(event.dataTransfer.files).find(
        (item) => item.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(item.name)
      );
      if (!file) {
        toast.error("Drop a video file (mp4, mov, mkv, webm...).");
        return;
      }
      void uploadFile(file);
    },
    [submitting, uploading, uploadFile]
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

  return (
    <div>
      <PageHeader
        eyebrow="Distribute"
        title="Stream Pipeline"
        description="Drop one stream in at the top — the long-form edit, short clips, podcast MP3, carousel images, and text posts all come out below, ready to schedule."
      />

      {/* Ingest: the single entry point the whole pipeline hangs off. */}
      <Card
        className={cn("p-5 transition", dragActive && "border-[var(--accent)] bg-white/5")}
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
        onDrop={onDrop}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitUrl();
              }}
              placeholder="Paste a stream / VOD link (YouTube, Twitch...)"
              className="pl-9"
              disabled={submitting || uploading}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void submitUrl()} disabled={submitting || uploading || !url.trim()}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Run pipeline
            </Button>
            <Button
              variant="secondary"
              onClick={() => uploadInputRef.current?.click()}
              disabled={submitting || uploading}
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload file
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          One link or file is all it takes — or drag a video anywhere onto this card.
        </p>
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
      </Card>

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

      {/* The flow itself: source at the top, scheduler at the bottom. */}
      {!loaded ? null : !active || !run || !stages ? (
        <Card className="mt-6 p-10 text-center text-sm text-[var(--muted-foreground)]">
          No runs yet. Paste a stream link or drop a file above and watch every format come out below.
        </Card>
      ) : (
        <div className="mt-6 lg:max-w-3xl">
          <StageRow icon={UploadCloud} title="Stream source" stage={stages.source} />

          <StageRow icon={Clapperboard} title="Long-form edit" stage={stages.longform}>
            <div className="mt-3">
              <Link href={longformHref}>
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Open in Long-Form Editor
                </Button>
              </Link>
            </div>
          </StageRow>

          <StageRow icon={Scissors} title="Short-form clips" stage={stages.clips}>
            <div className="mt-3">
              <Link href="/clips">
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Open in Clip Generator
                </Button>
              </Link>
            </div>
          </StageRow>

          <StageRow icon={Podcast} title="Podcast MP3" stage={stages.audio}>
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

          <StageRow icon={Images} title="Carousel images" stage={stages.images}>
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

          <StageRow icon={AtSign} title="Text-only posts" stage={stages.posts}>
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

          <StageRow icon={CalendarClock} title="Scheduler" stage={stages.schedule} last>
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
      )}
    </div>
  );
}
