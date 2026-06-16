"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Download, Film, Link as LinkIcon, Loader2, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import type { ClipCandidate, ClipJob, ClipJobStage } from "@/lib/clipping/types";
import { cn } from "@/lib/utils";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ACCEPT = ".mp4,.mov,.webm,.mkv,.avi,video/*";

const STAGE_LABELS: Record<ClipJobStage, string> = {
  uploading: "Uploading",
  downloading: "Downloading stream audio",
  probing: "Reading video",
  "analyzing-audio": "Analyzing audio energy",
  transcribing: "Transcribing",
  "selecting-clips": "Selecting clip candidates",
  "rendering-clips": "Rendering clips (vertical + widescreen)",
  "writing-captions": "Writing captions",
  "generating-metadata": "Generating titles & captions",
  finished: "Done"
};

const STEPS: Array<{ label: string; stages: ClipJobStage[] }> = [
  { label: "Source", stages: ["uploading", "downloading", "probing"] },
  { label: "Analyze", stages: ["analyzing-audio", "transcribing", "selecting-clips"] },
  { label: "Render", stages: ["rendering-clips", "writing-captions"] },
  { label: "Review", stages: ["generating-metadata", "finished"] }
];

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Clipboard access was blocked by the browser.");
  }
}

function fileUrl(jobId: string, fileName: string, download = false) {
  return `/api/clips/${jobId}/files/${encodeURIComponent(fileName)}${download ? "?download=1" : ""}`;
}

export function ClippingAgentPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [submittingUrl, setSubmittingUrl] = useState(false);

  const activeJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null;
  const processing = activeJob?.status === "processing" || activeJob?.status === "queued";

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

  // Poll while any job is in flight.
  useEffect(() => {
    if (!jobs.some((job) => job.status === "processing" || job.status === "queued")) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const upload = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)) {
        toast.error(`"${file.name}" is not a supported video. Use MP4, MOV, WebM, MKV, or AVI.`);
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`That file is ${(file.size / 1_000_000).toFixed(0)}MB. The limit is 500MB, so trim or compress it first.`);
        return;
      }

      const form = new FormData();
      form.append("video", file);
      form.append("topic", topic.trim());

      // XHR instead of fetch so we get real upload progress for large files.
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/clips");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadPct(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        setUploadPct(null);
        if (xhr.status === 201) {
          const { job } = JSON.parse(xhr.responseText) as { job: ClipJob };
          setActiveJobId(job.id);
          toast.success("Upload complete. Processing started.");
          void refresh();
        } else {
          let message = "Upload failed.";
          try {
            message = (JSON.parse(xhr.responseText) as { error: string }).error;
          } catch {
            /* keep generic message */
          }
          toast.error(message);
        }
      };
      xhr.onerror = () => {
        setUploadPct(null);
        toast.error("Upload failed. Is the dev server still running?");
      };
      setUploadPct(0);
      xhr.send(form);
    },
    [topic, refresh]
  );

  const submitUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      toast.error("Paste a full video/VOD link starting with http:// or https://.");
      return;
    }
    setSubmittingUrl(true);
    try {
      const response = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, topic: topic.trim() })
      });
      const data = (await response.json()) as { job?: ClipJob; error?: string };
      if (response.ok && data.job) {
        setActiveJobId(data.job.id);
        setUrl("");
        toast.success("Link accepted. Downloading and analyzing the stream.");
        void refresh();
      } else {
        toast.error(data.error ?? "Could not start the job from that URL.");
      }
    } catch {
      toast.error("Request failed. Is the dev server still running?");
    } finally {
      setSubmittingUrl(false);
    }
  }, [url, topic, refresh]);

  const removeJob = async (job: ClipJob) => {
    const response = await fetch(`/api/clips/${job.id}`, { method: "DELETE" });
    if (response.ok) {
      toast.success("Job and its files deleted.");
      if (activeJobId === job.id) setActiveJobId(null);
      void refresh();
    } else {
      const { error } = (await response.json()) as { error: string };
      toast.error(error);
    }
  };

  const currentStepIndex = activeJob
    ? activeJob.status === "done"
      ? STEPS.length - 1
      : STEPS.findIndex((step) => step.stages.includes(activeJob.stage))
    : -1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Clipping Agent"
        description="Paste a stream URL (or upload a file) and get ranked clip suggestions — each rendered as both a 9:16 short and a 16:9 long-form cut, with captions and metadata, scored by audio energy, hooks, and pacing."
      />

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        {/* Left: upload + history */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold text-white">Step 1: Add a stream</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Paste a YouTube or Twitch VOD link — only the audio and the chosen clip ranges are
              downloaded, so even 90-minute streams process fast.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
                event.target.value = "";
              }}
            />
            <div className="mt-4">
              <Input
                placeholder="Video topic (optional, improves title and caption suggestions)"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="https://youtube.com/watch?v=… or a Twitch VOD link"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submittingUrl) void submitUrl();
                }}
                disabled={submittingUrl}
              />
              <Button onClick={() => void submitUrl()} disabled={submittingUrl || !url.trim()}>
                {submittingUrl ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                Clip from URL
              </Button>
            </div>

            <div className="my-4 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
              <span className="h-px flex-1 bg-white/10" />
              or upload a file (MP4/MOV/WebM/MKV/AVI · up to 500MB)
              <span className="h-px flex-1 bg-white/10" />
            </div>
            {uploadPct !== null ? (
              <div className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-white">
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
                  </span>
                  <span className="text-[var(--muted-foreground)]">{uploadPct}%</span>
                </div>
                <Progress value={uploadPct} />
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) upload(file);
                }}
                onDragOver={(event) => event.preventDefault()}
                className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/12 bg-white/3 py-10 transition hover:border-[var(--accent)]/50"
              >
                <UploadCloud className="h-7 w-7 text-[var(--accent)]" />
                <p className="text-sm font-semibold text-white">Drop a video here or click to browse</p>
                <p className="text-xs text-[var(--muted-foreground)]">Processing happens locally with FFmpeg</p>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Jobs</h2>
            {!loaded ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">Loading…</p>
            ) : jobs.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Nothing yet. Upload a video above. Each run shows up here with its clips, ready to re-open or delete.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setActiveJobId(job.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition",
                      activeJob?.id === job.id
                        ? "border-[var(--accent)]/60 bg-[var(--accent)]/8"
                        : "border-white/10 bg-black/20 hover:border-white/25"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{job.fileName}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {new Date(job.createdAt).toLocaleString()} · {job.clips.length} clips
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        className={cn(
                          job.status === "done" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                          job.status === "error" && "border-red-400/30 bg-red-400/10 text-red-300"
                        )}
                      >
                        {job.status === "processing" || job.status === "queued" ? STAGE_LABELS[job.stage] : job.status}
                      </Badge>
                      {job.status !== "processing" && job.status !== "queued" && (
                        <span
                          role="button"
                          title="Delete job and files"
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeJob(job);
                          }}
                          className="text-[var(--muted-foreground)] transition hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right: pipeline status + results */}
        <div className="space-y-4">
          {!activeJob ? (
            <Card className="flex flex-col items-center gap-3 py-14 text-center">
              <Film className="h-8 w-8 text-[var(--accent)]" />
              <p className="text-sm font-semibold text-white">No job selected</p>
              <p className="max-w-md text-sm text-[var(--muted-foreground)]">
                Paste a VOD link or upload a video on the left. The agent analyzes audio energy, finds the strongest
                moments, renders each as a 9:16 short and a 16:9 long-form cut, and suggests titles and captions.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-white">{activeJob.fileName}</h2>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {activeJob.durationSec ? `${formatTimestamp(activeJob.durationSec)} long · ` : ""}
                      {activeJob.topic ? `Topic: ${activeJob.topic}` : "No topic provided"}
                    </p>
                  </div>
                  {processing && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--accent)]" />}
                </div>

                <div className="mt-5 flex items-center gap-2">
                  {STEPS.map((step, index) => {
                    const done = activeJob.status === "done" || index < currentStepIndex;
                    const current = index === currentStepIndex && activeJob.status !== "done";
                    return (
                      <div key={step.label} className="flex flex-1 items-center gap-2">
                        <div
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                            done
                              ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                              : current
                                ? "border border-[var(--accent)] text-[var(--accent)]"
                                : "border border-white/15 text-[var(--muted-foreground)]"
                          )}
                        >
                          {done ? <Check className="h-4 w-4" /> : index + 1}
                        </div>
                        <span className={cn("text-xs", done || current ? "text-white" : "text-[var(--muted-foreground)]")}>
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {processing && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white">{STAGE_LABELS[activeJob.stage]}…</span>
                      <span className="text-[var(--muted-foreground)]">{activeJob.progress}%</span>
                    </div>
                    <Progress value={activeJob.progress} />
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Long videos can take several minutes. You can leave this page and the job keeps running.
                    </p>
                  </div>
                )}

                {activeJob.status === "error" && (
                  <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/8 p-4">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <p className="text-sm text-red-200">{activeJob.error}</p>
                  </div>
                )}

                {activeJob.notices.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {activeJob.notices.map((notice) => (
                      <div key={notice} className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/8 p-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <p className="text-xs leading-relaxed text-amber-100">{notice}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {activeJob.status === "done" &&
                activeJob.clips.map((clip, index) => (
                  <ClipCard key={clip.id} clip={clip} index={index} jobId={activeJob.id} />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ClipCard({ clip, index, jobId }: { clip: ClipCandidate; index: number; jobId: string }) {
  const metadataText = clip.metadata
    ? [
        `Title: ${clip.metadata.title}`,
        `Hook: ${clip.metadata.hook}`,
        `Description: ${clip.metadata.description}`,
        `Caption: ${clip.metadata.caption}`,
        `Hashtags: ${clip.metadata.hashtags.map((tag) => `#${tag}`).join(" ")}`
      ].join("\n")
    : null;

  return (
    <Card>
      <div className="flex flex-col gap-5 sm:flex-row">
        {(clip.file || clip.wideFile) && (
          <div className="flex w-full shrink-0 flex-col gap-3 sm:w-[210px]">
            {clip.file && (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  9:16 Short
                </p>
                <video
                  src={fileUrl(jobId, clip.file)}
                  controls
                  preload="metadata"
                  className="aspect-[9/16] w-full rounded-2xl bg-black ring-1 ring-white/10"
                />
              </div>
            )}
            {clip.wideFile && (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  16:9 Long-form
                </p>
                <video
                  src={fileUrl(jobId, clip.wideFile)}
                  controls
                  preload="metadata"
                  className="aspect-video w-full rounded-2xl bg-black ring-1 ring-white/10"
                />
              </div>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]">#{index + 1}</Badge>
            <Badge>
              {formatTimestamp(clip.start)} – {formatTimestamp(clip.end)}
            </Badge>
            <Badge>{Math.round(clip.end - clip.start)}s</Badge>
            {clip.score > 0 && (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">Score {clip.score}</Badge>
            )}
          </div>

          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{clip.rationale}</p>

          {clip.score > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {(
                [
                  ["Hook", clip.breakdown.hook],
                  ["Pacing", clip.breakdown.pacing],
                  ["Standalone", clip.breakdown.standalone],
                  ["Intensity", clip.breakdown.intensity]
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                    <span>{label}</span>
                    <span className="text-white">{value}</span>
                  </div>
                  <Progress value={value} className="h-1.5" />
                </div>
              ))}
            </div>
          )}

          {clip.metadata && (
            <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm font-semibold text-white">{clip.metadata.title}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                <span className="text-white/70">Hook:</span> {clip.metadata.hook}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">{clip.metadata.description}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                <span className="text-white/70">Caption:</span> {clip.metadata.caption}
              </p>
              <p className="text-xs text-[var(--accent)]">{clip.metadata.hashtags.map((tag) => `#${tag}`).join(" ")}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {clip.file && (
              <a href={fileUrl(jobId, clip.file, true)}>
                <Button>
                  <Download className="mr-2 h-4 w-4" />
                  Download 9:16
                </Button>
              </a>
            )}
            {clip.wideFile && (
              <a href={fileUrl(jobId, clip.wideFile, true)}>
                <Button variant="secondary">
                  <Download className="mr-2 h-4 w-4" />
                  Download 16:9
                </Button>
              </a>
            )}
            {clip.srtFile && (
              <a href={fileUrl(jobId, clip.srtFile, true)}>
                <Button variant="secondary">
                  <Download className="mr-2 h-4 w-4" />
                  Captions (.srt)
                </Button>
              </a>
            )}
            {metadataText && (
              <Button variant="secondary" onClick={() => void copyText(metadataText, "Metadata")}>
                <Copy className="mr-2 h-4 w-4" />
                Copy metadata
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
