"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Film,
  Link as LinkIcon,
  Loader2,
  RotateCw,
  Scissors,
  SquarePlay,
  Trash2,
  Upload
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle, makeClipProject } from "@/lib/clipping/editor";
import { cn } from "@/lib/utils";
import type { ClipCandidate, ClipJob, ClipJobStage, ClipJobStatus } from "@/lib/clipping/types";

const EDITOR_DRAFT_PREFIX = "capital-command:clip-editor-draft:";

const STAGE_LABELS: Record<ClipJobStage, string> = {
  downloading: "Fetching the source",
  analyzing: "Transcribing the audio",
  selecting: "Picking the best moments",
  rendering: "Rendering clips",
  finished: "Ready"
};

function formatTimestamp(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fileUrl(jobId: string, fileName: string, download = false) {
  return `/api/clips/${jobId}/files/${encodeURIComponent(fileName)}${download ? "?download=1" : ""}`;
}

function thumbnailUrl(jobId: string, fileName: string) {
  return `/api/clips/${jobId}/thumbnail/${encodeURIComponent(fileName)}`;
}

function statusLabel(job: ClipJob) {
  if (job.status === "queued" || job.status === "processing") return STAGE_LABELS[job.stage];
  if (job.status === "done") return "Ready";
  return "Needs attention";
}

function statusClass(status: ClipJobStatus) {
  if (status === "done") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (status === "error") return "border-red-400/30 bg-red-400/10 text-red-300";
  return "border-sky-400/30 bg-sky-400/10 text-sky-300";
}

function clipHeadline(clip: ClipCandidate, index: number) {
  if (clip.hookQuote) return clip.hookQuote;
  const quoted = clip.rationale.match(/"([^"]{8,90})"/);
  return quoted?.[1] ?? `Clip ${index + 1}`;
}

export function ClipGeneratorPage() {
  const router = useRouter();
  const { mutate } = useAppData();
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null,
    [activeJobId, jobs]
  );
  const processing = activeJob?.status === "processing" || activeJob?.status === "queued";
  // A clip is viewable as soon as it has an instant preview OR its final HD
  // render — clips stream into the workspace while the job is still running.
  const previewableClips = useMemo(
    () => (activeJob ? activeJob.clips.filter((clip) => clip.file || clip.previewFile) : []),
    [activeJob]
  );
  const failedClipCount =
    activeJob?.status === "done" ? activeJob.clips.filter((clip) => !clip.file).length : 0;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/clips", { cache: "no-store" });
      if (!response.ok) return;
      const { jobs: list } = (await response.json()) as { jobs: ClipJob[] };
      setJobs(list);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "processing" || job.status === "queued")) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const startJob = useCallback(
    async (body: { url?: string; sourceId?: string; topic?: string }) => {
      const response = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as { job?: ClipJob; error?: string };
      if (response.ok && data.job) {
        setActiveJobId(data.job.id);
        setUrl("");
        setBrief("");
        toast.success("Stream added. Finding the best moments now.");
        void refresh();
      } else {
        toast.error(data.error ?? "Could not start clipping that source.");
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
      await startJob({ url: trimmed, topic: brief.trim() || undefined });
    } catch {
      toast.error("Request failed. Is the dev server still running?");
    } finally {
      setSubmitting(false);
    }
  }, [brief, startJob, url]);

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
        await startJob({ sourceId: data.source.id, topic: brief.trim() || undefined });
      } catch {
        toast.error("Upload failed. Is the dev server still running?");
      } finally {
        setUploading(false);
      }
    },
    [brief, startJob]
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

  const editClip = useCallback(
    async (job: ClipJob, clip: ClipCandidate, index: number, sourceFile = clip.file) => {
      if (!sourceFile) return;
      const project = makeClipProject({
        jobId: job.id,
        name: `${job.fileName} - clip ${index + 1}`,
        sourceFile,
        posterFile: clip.posterFile,
        sourceUrl: job.sourceUrl,
        clipStart: clip.start,
        clipEnd: clip.end
      });
      const windowed = windowSegments(job.sourceCaptions ?? [], clip.start, clip.end);
      const words = windowed.flatMap((segment) => segment.words);
      project.captions = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
      project.title = generateClipTitle(project.captions, `Clip ${index + 1}`);
      if (project.title) project.name = project.title;
      if (typeof window !== "undefined") {
        const draft = JSON.stringify(project);
        sessionStorage.setItem(`${EDITOR_DRAFT_PREFIX}${project.id}`, draft);
        localStorage.setItem(`${EDITOR_DRAFT_PREFIX}${project.id}`, draft);
      }
      const params = new URLSearchParams({
        open: project.id,
        job: job.id,
        file: sourceFile,
        clip: String(index)
      });
      router.push(`/editor?${params.toString()}`);
      void mutate("upsertClipProject", project);
    },
    [mutate, router]
  );

  const removeJob = async (job: ClipJob) => {
    const response = await fetch(`/api/clips/${job.id}`, { method: "DELETE" });
    if (response.ok) {
      toast.success("Stream and its files deleted.");
      if (activeJobId === job.id) setActiveJobId(null);
      void refresh();
    } else {
      const { error } = (await response.json()) as { error: string };
      toast.error(error);
    }
  };

  const retryFailedRenders = async (job: ClipJob) => {
    setRetryingJobId(job.id);
    try {
      const response = await fetch(`/api/clips/${job.id}`, { method: "POST" });
      const data = (await response.json()) as { job?: ClipJob; error?: string };
      if (response.ok && data.job) {
        toast.success("Retrying the missing clip renders.");
        setActiveJobId(data.job.id);
        void refresh();
      } else {
        toast.error(data.error ?? "Could not retry the missing clips.");
      }
    } catch {
      toast.error("Retry failed. Is the dev server still running?");
    } finally {
      setRetryingJobId(null);
    }
  };

  const busy = submitting || uploading;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="YouTube creator tools"
        title="Clip Generator"
        description="Turn a raw livestream or recording into short clips: every source is transcribed and captioned automatically, the best moments are picked and titled, and each clip opens in the editor ready to export for Shorts and Reels."
      />

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)]">
                <Scissors className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-white">Add a stream</h2>
                <p className="text-xs text-[var(--muted-foreground)]">Paste a VOD link or upload a recording</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) void submitUrl();
                }}
                disabled={busy}
              />
              <Textarea
                placeholder="Optional focus: trading mistakes, best stories, spicy takes..."
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                disabled={busy}
                className="min-h-20"
              />
              <Button onClick={() => void submitUrl()} disabled={busy || !url.trim()} className="w-full">
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                Find clips
              </Button>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                <span className="h-px flex-1 bg-[var(--border)]" />
                or
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadFile(file);
                  event.target.value = "";
                }}
              />
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  dragDepth.current += 1;
                  setDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  dragDepth.current = Math.max(0, dragDepth.current - 1);
                  if (dragDepth.current === 0) setDragActive(false);
                }}
                onDrop={onDrop}
                className={cn(
                  "rounded-lg border border-dashed p-1 transition",
                  dragActive
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-transparent"
                )}
              >
                <Button
                  variant="secondary"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={busy}
                  className="w-full"
                >
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {dragActive ? "Drop to upload" : uploading ? "Uploading..." : "Upload a video file"}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white">Your streams</h2>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void refresh()}>
                <RotateCw className="mr-1 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
            {!loaded ? (
              <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No streams yet. Paste a link or upload a recording above.
              </p>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setActiveJobId(job.id)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition",
                      activeJob?.id === job.id
                        ? "border-[var(--accent)]/70 bg-[var(--accent)]/10"
                        : "border-white/10 bg-black/20 hover:border-white/25"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{job.fileName}</p>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {new Date(job.createdAt).toLocaleDateString()}
                          {job.clips.length > 0 && ` · ${job.clips.length} clips`}
                        </p>
                      </div>
                      <Badge className={cn("shrink-0", statusClass(job.status))}>{statusLabel(job)}</Badge>
                    </div>
                    {(job.status === "processing" || job.status === "queued") && (
                      <Progress value={job.progress} className="mt-3 h-1.5" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {!activeJob ? (
            <Card className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center">
              <Film className="h-9 w-9 text-[var(--accent)]" />
              <p className="text-base font-semibold text-white">Ready for a stream</p>
              <p className="max-w-md text-sm text-[var(--muted-foreground)]">
                Add a stream on the left and the best moments will show up here, ready to open in the editor.
              </p>
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={statusClass(activeJob.status)}>{statusLabel(activeJob)}</Badge>
                      {activeJob.durationSec ? <Badge>{formatTimestamp(activeJob.durationSec)}</Badge> : null}
                      {activeJob.topic && <Badge>{activeJob.topic}</Badge>}
                    </div>
                    <h2 className="mt-3 truncate text-2xl font-semibold text-white">{activeJob.fileName}</h2>
                    <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">
                      {activeJob.sourceId ? "Uploaded file" : activeJob.sourceUrl}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {failedClipCount > 0 && !processing && (
                      <Button
                        variant="secondary"
                        onClick={() => void retryFailedRenders(activeJob)}
                        disabled={retryingJobId === activeJob.id}
                      >
                        {retryingJobId === activeJob.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCw className="mr-2 h-4 w-4" />
                        )}
                        Retry missing
                      </Button>
                    )}
                    {!processing && (
                      <Button variant="danger" onClick={() => void removeJob(activeJob)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                {processing && (
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white">{STAGE_LABELS[activeJob.stage]}...</span>
                      <span className="text-[var(--muted-foreground)]">{activeJob.progress}%</span>
                    </div>
                    <Progress value={activeJob.progress} />
                  </div>
                )}

                {activeJob.status === "error" && (
                  <Notice tone="danger" text={activeJob.error ?? "This job could not finish."} />
                )}

                {activeJob.notices.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {activeJob.notices.map((notice) => (
                      <Notice key={notice} tone="warning" text={notice} />
                    ))}
                  </div>
                )}
              </Card>

              {(activeJob.status === "done" || previewableClips.length > 0) && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-white">Clips</h2>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {processing
                          ? `${previewableClips.length} clip${previewableClips.length === 1 ? "" : "s"} so far — previews appear the moment each one is cut, HD renders finish in the background.`
                          : `${previewableClips.length} clip${previewableClips.length === 1 ? "" : "s"}, best first. Open one to trim, pick a layout, and export.`}
                      </p>
                    </div>
                    {failedClipCount > 0 && (
                      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
                        {failedClipCount} missing render{failedClipCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  {previewableClips.length === 0 ? (
                    <Card className="flex flex-col items-center gap-2 py-10 text-center">
                      <AlertTriangle className="h-6 w-6 text-amber-300" />
                      <p className="text-sm font-semibold text-white">No clips could be rendered</p>
                      <p className="max-w-md text-sm text-[var(--muted-foreground)]">
                        Use “Retry missing” above, or delete this stream and try adding it again.
                      </p>
                    </Card>
                  ) : (
                    <div className="grid gap-3 2xl:grid-cols-2">
                      {activeJob.clips.map((clip, index) =>
                        clip.file || clip.previewFile ? (
                          <ClipCard
                            key={clip.id}
                            clip={clip}
                            index={index}
                            jobId={activeJob.id}
                            onEdit={() => void editClip(activeJob, clip, index)}
                          />
                        ) : null
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "warning" | "danger"; text: string }) {
  return (
    <div
      className={cn(
        "mt-4 flex items-start gap-3 rounded-lg border p-3",
        tone === "danger" ? "border-red-400/25 bg-red-500/10" : "border-amber-400/25 bg-amber-500/10"
      )}
    >
      <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "danger" ? "text-red-400" : "text-amber-400")} />
      <p className={cn("min-w-0 break-words text-xs leading-relaxed", tone === "danger" ? "text-red-200" : "text-amber-100")}>
        {text}
      </p>
    </div>
  );
}

function ClipCard({
  clip,
  index,
  jobId,
  onEdit
}: {
  clip: ClipCandidate;
  index: number;
  jobId: string;
  onEdit: () => void;
}) {
  const duration = Math.round(clip.end - clip.start);
  const videoRef = useRef<HTMLVideoElement>(null);
  // The instant preview holds the same content as the HD master (the master is
  // a re-encode of the same section), so cards always play the lighter file.
  const playbackFile = clip.previewFile ?? clip.file;
  const stopTimerRef = useRef<number | null>(null);

  // Once a hover preview starts, let it run at least this long even if the
  // pointer leaves — a quick flick across the grid shouldn't cut the preview
  // off after half a second.
  const MIN_PREVIEW_SECONDS = 5;

  const cancelPendingStop = () => {
    if (stopTimerRef.current !== null) {
      window.clearInterval(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  // Hover (or focus) scrubs the clip silently — lets you scan moments without
  // opening the editor.
  const startPreview = () => {
    const v = videoRef.current;
    if (!v) return;
    cancelPendingStop();
    v.muted = true;
    // The card mounts with preload="none" so the grid renders instantly off
    // the poster; only start buffering the mp4 once someone shows interest.
    v.preload = "auto";
    void v.play().catch(() => undefined);
  };
  const stopPreview = () => {
    const v = videoRef.current;
    if (!v) return;
    const finish = () => {
      cancelPendingStop();
      v.pause();
      v.currentTime = 0;
    };
    // Compare against played time (currentTime, since previews start at 0)
    // rather than wall-clock time, so buffering stalls don't eat the minimum.
    const minimum = Number.isFinite(v.duration)
      ? Math.min(MIN_PREVIEW_SECONDS, Math.max(0, v.duration - 0.25))
      : MIN_PREVIEW_SECONDS;
    if (v.paused || v.currentTime >= minimum) {
      finish();
      return;
    }
    cancelPendingStop();
    stopTimerRef.current = window.setInterval(() => {
      if (v.currentTime >= minimum || v.paused) finish();
    }, 200);
  };
  useEffect(
    () => () => {
      if (stopTimerRef.current !== null) window.clearInterval(stopTimerRef.current);
    },
    []
  );

  return (
    <Card className="animate-in overflow-hidden p-0 transition-all duration-200 hover:border-[var(--border-strong)] hover:shadow-lg">
      <div className="grid min-h-full md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="relative bg-black" onPointerEnter={startPreview} onPointerLeave={stopPreview}>
          {playbackFile && (
            <video
              ref={videoRef}
              src={fileUrl(jobId, playbackFile)}
              // The poster paints the card instantly; the mp4 itself is not
              // touched until hover, so ten cards don't fight over bandwidth
              // (and show black boxes) while the page loads. Prefer the
              // eagerly-generated poster frame, falling back to the on-demand
              // thumbnail route for clips rendered before it existed.
              poster={clip.posterFile ? fileUrl(jobId, clip.posterFile) : clip.file ? thumbnailUrl(jobId, clip.file) : undefined}
              preload="none"
              muted
              loop
              playsInline
              className="aspect-video h-full min-h-32 w-full object-contain md:aspect-auto"
            />
          )}
          <Badge className="absolute left-3 top-3 border-[var(--accent)]/30 bg-black/70 text-[var(--accent)]">
            #{index + 1}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-base font-semibold text-white">{clipHeadline(clip, index)}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge>
                {formatTimestamp(clip.start)} - {formatTimestamp(clip.end)}
              </Badge>
              <Badge>{duration}s</Badge>
              {clip.score > 0 && (
                <Badge
                  className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  title={clip.rationale}
                >
                  Score {clip.score}
                </Badge>
              )}
            </div>
          </div>

          <p className="line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">{clip.rationale}</p>

          {!clip.file && (
            <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-[var(--muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Finalizing the HD render — hover to preview it now
            </div>
          )}

          {clip.file && (
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <Button className="px-3 py-1.5 text-xs" onClick={onEdit}>
                <SquarePlay className="mr-1.5 h-3.5 w-3.5" />
                Open in editor
              </Button>
              <a
                href={fileUrl(jobId, clip.file, true)}
                download={`${jobId}-${clip.file}`}
                className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download
              </a>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
