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
import { ClipFrame } from "@/components/clips/clip-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_CLIP_COUNT, TARGET_CLIP_COUNT } from "@/lib/clipping/clip-count";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { loadJobCaptions, loadJobSilences } from "@/lib/clipping/captions-client";
import { generateClipTitle, makeClipProject, makeTitleOverlay } from "@/lib/clipping/editor";
import { buildClipSegments, buildClipSegmentsFromSilences } from "@/lib/clipping/segments";
import { writeDraftProject } from "@/components/editor/drafts";
import { cn, safeFilename } from "@/lib/utils";
import type { ClipCandidate, ClipJob, ClipJobStage, ClipJobStatus } from "@/lib/clipping/types";

// Preset clip counts offered in the generator. Kept within [1, MAX_CLIP_COUNT];
// bigger streams warrant more clips, so the range runs well past the default.
const CLIP_COUNT_OPTIONS = [3, 5, 10, 15, 20, 25, 30, 40, MAX_CLIP_COUNT];

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
  if (clip.title) return clip.title;
  if (clip.hookQuote) return clip.hookQuote;
  const quoted = clip.rationale.match(/"([^"]{8,90})"/);
  return quoted?.[1] ?? `Clip ${index + 1}`;
}

export function ClipGeneratorPage() {
  const router = useRouter();
  const { data, mutate } = useAppData();
  const clipProjects = data.clipProjects;
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [clipCount, setClipCount] = useState(TARGET_CLIP_COUNT);
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
    async (body: { url?: string; sourceId?: string; topic?: string; clipCount?: number }) => {
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
      await startJob({ url: trimmed, topic: brief.trim() || undefined, clipCount });
    } catch {
      toast.error("Request failed. Is the dev server still running?");
    } finally {
      setSubmitting(false);
    }
  }, [brief, clipCount, startJob, url]);

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
        await startJob({ sourceId: data.source.id, topic: brief.trim() || undefined, clipCount });
      } catch {
        toast.error("Upload failed. Is the dev server still running?");
      } finally {
        setUploading(false);
      }
    },
    [brief, clipCount, startJob]
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

  const renameClip = useCallback(
    async (job: ClipJob, clip: ClipCandidate, title: string) => {
      const trimmed = title.trim();
      if (trimmed === (clip.title ?? "")) return;
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, clips: j.clips.map((c) => (c.id === clip.id ? { ...c, title: trimmed || undefined } : c)) }
            : j
        )
      );
      try {
        const response = await fetch(`/api/clips/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clipId: clip.id, clipTitle: trimmed })
        });
        if (!response.ok) throw new Error();
      } catch {
        toast.error("Could not rename the clip.");
        void refresh();
      }
    },
    [refresh]
  );

  const editClip = useCallback(
    async (job: ClipJob, clip: ClipCandidate, index: number, sourceFile = clip.file) => {
      if (!sourceFile) return;
      // Re-open the existing project for this clip so earlier edits are kept —
      // only build a fresh project the first time a clip is opened.
      const existing = clipProjects
        .filter((p) => p.jobId === job.id && p.sourceFile === sourceFile)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (existing) {
        const params = new URLSearchParams({
          open: existing.id,
          job: job.id,
          file: sourceFile,
          clip: String(index)
        });
        router.push(`/editor?${params.toString()}`);
        return;
      }
      const project = makeClipProject({
        jobId: job.id,
        name: `${job.fileName} - clip ${index + 1}`,
        sourceFile,
        posterFile: clip.posterFile,
        sourceUrl: job.sourceUrl,
        clipStart: clip.start,
        clipEnd: clip.end
      });
      const [captions, silences] = await Promise.all([loadJobCaptions(job.id), loadJobSilences(job.id)]);
      const windowed = windowSegments(captions, clip.start, clip.end);
      const words = windowed.flatMap((segment) => segment.words);
      project.captions = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
      const localSilences = silences
        .filter((silence) => silence.end > clip.start && silence.start < clip.end)
        .map((silence) => ({
          start: Math.max(0, silence.start - clip.start),
          end: Math.min(project.baseDurationSec, silence.end - clip.start)
        }));
      project.segments = localSilences.length
        ? buildClipSegmentsFromSilences(project.baseDurationSec, localSilences)
        : buildClipSegments(project.baseDurationSec, project.captions);
      project.title = clip.title || generateClipTitle(project.captions, `Clip ${index + 1}`);
      if (project.title) project.name = project.title;
      project.overlays = [...project.overlays, makeTitleOverlay(project)];
      // Share the auto-generated title with the backend clip so the Generator
      // and the Uploading Center headline match the editor from the start.
      if (project.title && !clip.title) void renameClip(job, clip, project.title);
      writeDraftProject(project);
      const params = new URLSearchParams({
        open: project.id,
        job: job.id,
        file: sourceFile,
        clip: String(index)
      });
      router.push(`/editor?${params.toString()}`);
      void mutate("upsertClipProject", project);
    },
    [clipProjects, mutate, renameClip, router]
  );

  const renameProject = useCallback(
    async (job: ClipJob, fileName: string) => {
      const trimmed = fileName.trim();
      if (!trimmed || trimmed === job.fileName) return;
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, fileName: trimmed } : j)));
      try {
        const response = await fetch(`/api/clips/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: trimmed })
        });
        if (!response.ok) throw new Error();
      } catch {
        toast.error("Could not rename the project.");
        void refresh();
      }
    },
    [refresh]
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
        eyebrow="Step 2 · Formats"
        title="Clip Generator"
        description="Turn a raw livestream or recording into short clips: every source is transcribed and captioned automatically, the best moments are picked and titled, and each clip opens in the editor ready to export for Shorts and Reels."
      />

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
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
              <div className="space-y-1.5">
                <label
                  htmlFor="clip-count"
                  className="block text-xs font-medium text-[var(--muted-foreground)]"
                >
                  Clips to generate
                </label>
                <Select
                  id="clip-count"
                  value={clipCount}
                  onChange={(event) => setClipCount(Number(event.target.value))}
                  disabled={busy}
                  aria-label="Number of clips to generate"
                >
                  {CLIP_COUNT_OPTIONS.map((count) => (
                    <option key={count} value={count}>
                      {count} clip{count === 1 ? "" : "s"}
                      {count === TARGET_CLIP_COUNT ? " (default)" : ""}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
                  Longer streams have more clippable moments — pick more for a multi-hour VOD (up to {MAX_CLIP_COUNT}).
                </p>
              </div>
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
                  <div
                    key={job.id}
                    onClick={() => setActiveJobId(job.id)}
                    className={cn(
                      "w-full cursor-pointer rounded-lg border p-3 text-left transition",
                      activeJob?.id === job.id
                        ? "border-[var(--accent)]/70 bg-[var(--accent)]/10"
                        : "border-white/10 bg-[var(--well)] hover:border-white/25"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          title={job.fileName}
                          className="overflow-x-auto whitespace-nowrap text-sm font-medium text-white [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1"
                        >
                          {job.fileName}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {new Date(job.createdAt).toLocaleDateString()}
                          {job.clips.length > 0 && ` · ${job.clips.length} clips`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge className={statusClass(job.status)}>{statusLabel(job)}</Badge>
                        {job.status !== "processing" && job.status !== "queued" && (
                          <button
                            type="button"
                            aria-label="Delete stream"
                            title="Delete stream"
                            onClick={(event) => {
                              event.stopPropagation();
                              void removeJob(job);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {(job.status === "processing" || job.status === "queued") && (
                      <Progress value={job.progress} className="mt-3 h-1.5" />
                    )}
                  </div>
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
                    <EditableTitle
                      as="h2"
                      text={activeJob.fileName}
                      onCommit={(next) => void renameProject(activeJob, next)}
                      ariaLabel="Project title"
                      className="mt-3 truncate text-2xl font-semibold text-white"
                      inputClassName="mt-3 w-full rounded-md border border-[var(--accent)]/50 bg-[var(--well-deep)] px-2 py-1 text-2xl font-semibold text-white outline-none"
                    />
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
                            onRename={(title) => void renameClip(activeJob, clip, title)}
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

function EditableTitle({
  text,
  onCommit,
  as: Tag = "h2",
  className,
  inputClassName,
  multiline = false,
  ariaLabel
}: {
  text: string;
  onCommit: (next: string) => void;
  as?: "h2" | "h3";
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const el = multiline ? textareaRef.current : inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing, multiline]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== text) onCommit(next);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={textareaRef}
          rows={2}
          value={draft}
          aria-label={ariaLabel}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className={inputClassName}
        />
      );
    }

    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
        className={inputClassName}
      />
    );
  }

  return (
    <Tag
      className={cn("cursor-text", className)}
      title="Double-click to rename"
      onDoubleClick={() => {
        setDraft(text);
        setEditing(true);
      }}
    >
      {text}
    </Tag>
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
  onEdit,
  onRename
}: {
  clip: ClipCandidate;
  index: number;
  jobId: string;
  onEdit: () => void;
  onRename: (title: string) => void;
}) {
  const duration = Math.round(clip.end - clip.start);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Prefer the Clip Editor's export when the clip has been edited, then the
  // ready-to-post download clip (centered 9:16, captioned), so the preview
  // matches exactly what Download hands back. Until then fall back to the
  // instant preview or the neutral master.
  const playbackFile = clip.editedFile ?? clip.downloadFile ?? clip.previewFile ?? clip.file;
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
      <div className="grid min-h-full md:grid-cols-[220px_minmax(0,1fr)]">
        {/* The preview is a full 9:16 frame — the shape the clip actually posts
            in — so nothing is cut off, whichever file is backing it. */}
        <div
          className="relative mx-auto w-full max-w-[240px] md:max-w-none"
          onPointerEnter={startPreview}
          onPointerLeave={stopPreview}
        >
          <ClipFrame
            ref={videoRef}
            src={playbackFile ? fileUrl(jobId, playbackFile) : undefined}
            // The poster paints the card instantly; the mp4 itself is not
            // touched until hover, so ten cards don't fight over bandwidth
            // (and show black boxes) while the page loads. Prefer the
            // eagerly-generated poster frame, falling back to the on-demand
            // thumbnail route for clips rendered before it existed.
            poster={
              clip.posterFile
                ? fileUrl(jobId, clip.posterFile)
                : clip.file
                  ? thumbnailUrl(jobId, clip.file)
                  : undefined
            }
            preload="none"
            loop
          />
          <Badge className="absolute left-3 top-3 border-[var(--accent)]/30 bg-black/70 text-[var(--accent)]">
            #{index + 1}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-col gap-5 p-5 lg:p-6">
          <div className="min-w-0">
            <EditableTitle
              as="h3"
              text={clipHeadline(clip, index)}
              onCommit={onRename}
              ariaLabel={`Clip ${index + 1} title`}
              multiline
              className="line-clamp-3 text-lg font-semibold leading-7 text-white"
              inputClassName="min-h-20 w-full resize-none rounded-lg border border-[var(--accent)]/50 bg-[var(--well-deep)] px-3 py-2.5 text-lg font-semibold leading-7 text-white outline-none"
            />
            <div className="mt-4 flex flex-wrap gap-2">
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

          <div className="border-t border-white/8 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              Why this clip
            </p>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--muted-foreground)]">{clip.rationale}</p>
          </div>

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
                href={fileUrl(jobId, clip.editedFile ?? clip.downloadFile ?? clip.file, true)}
                download={`${safeFilename(clipHeadline(clip, index))}.${(clip.editedFile ?? clip.downloadFile ?? clip.file).split(".").pop() || "mp4"}`}
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
