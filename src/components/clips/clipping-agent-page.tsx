"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Download,
  Film,
  Info,
  Link as LinkIcon,
  Loader2,
  RotateCw,
  SquarePlay,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle, makeClipProject } from "@/lib/clipping/editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import type { AISuggestion } from "@/types/domain";
import type { ClipCandidate, ClipJob, ClipJobStage } from "@/lib/clipping/types";
import { cn } from "@/lib/utils";

const STAGE_LABELS: Record<ClipJobStage, string> = {
  downloading: "Downloading stream audio",
  analyzing: "Reading the transcript",
  selecting: "Selecting the best moments",
  rendering: "Rendering 16:9 clips",
  finished: "Done"
};

const STEPS: Array<{ label: string; stages: ClipJobStage[] }> = [
  { label: "Download", stages: ["downloading"] },
  { label: "Analyze", stages: ["analyzing", "selecting"] },
  { label: "Render", stages: ["rendering"] },
  { label: "Done", stages: ["finished"] }
];

const EDITOR_DRAFT_PREFIX = "capital-command:clip-editor-draft:";

/** Plain-language explanation of every score, surfaced in the dashboard. */
const SCORE_GUIDE: Array<{ key: keyof ClipCandidate["breakdown"]; label: string; measures: string; improve: string }> = [
  {
    key: "hook",
    label: "Hook",
    measures:
      "How attention-grabbing the first seconds are. Reads the opening line of the transcript for questions, numbers, “you”, and curiosity words, blended with how loud the open is versus the stream.",
    improve:
      "Trim the start so the clip opens on a question, a bold claim, or a number — not filler like “so…”, “um”, or mid-thought."
  },
  {
    key: "pacing",
    label: "Word density",
    measures:
      "How much useful speech is packed into the clip. This prioritizes spoken words-per-second, with a small audio-energy component so dense, active moments rise to the top.",
    improve:
      "Pick moments with continuous talking, fewer pauses, and compact explanations. Trim dead air before or after the dense part."
  },
  {
    key: "standalone",
    label: "Standalone",
    measures:
      "Whether the clip makes sense on its own. Checks that it starts and ends on complete sentences and does NOT open on a back-reference like “this”, “that”, or “and”, plus whether the cut lands on a natural pause.",
    improve:
      "Move the start/end so the clip begins a new sentence and finishes a full thought. Avoid opening on a word that points to something said earlier."
  },
  {
    key: "intensity",
    label: "Intensity",
    measures:
      "Emotional punch. Overall loudness percentile of the clip blended with emphatic language (exclamations, ALL-CAPS, words like “insane”, “never”, “huge”).",
    improve:
      "Choose peaks where the speaker is fired up, raising their voice, or making an emphatic point rather than calmly explaining."
  }
];

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fileUrl(jobId: string, fileName: string, download = false) {
  return `/api/clips/${jobId}/files/${encodeURIComponent(fileName)}${download ? "?download=1" : ""}`;
}

export function ClippingAgentPage() {
  const router = useRouter();
  const { mutate } = useAppData();
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [submittingUrl, setSubmittingUrl] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const activeJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null;
  const processing = activeJob?.status === "processing" || activeJob?.status === "queued";
  const failedClipCount = activeJob?.clips.filter((clip) => !clip.file).length ?? 0;

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
        body: JSON.stringify({ url: trimmed })
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
  }, [url, refresh]);

  const editClip = useCallback(
    async (job: ClipJob, clip: ClipCandidate, index: number, sourceFile = clip.file) => {
      if (!sourceFile) return;
      const project = makeClipProject({
        jobId: job.id,
        name: `${job.fileName} — clip ${index + 1}`,
        sourceFile,
        sourceUrl: job.sourceUrl,
        clipStart: clip.start,
        clipEnd: clip.end
      });
      const windowed = windowSegments(job.sourceCaptions ?? [], clip.start, clip.end);
      const words = windowed.flatMap((segment) => segment.words);
      project.captions = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
      project.title = generateClipTitle(project.captions, `Clip ${index + 1}`);
      if (project.title) project.name = project.title;

      const suggestion: AISuggestion = {
        id: `sug-${crypto.randomUUID().slice(0, 8)}`,
        start: 0,
        end: project.baseDurationSec,
        score: clip.score,
        rationale: clip.rationale,
        status: "pending",
        addedToTimeline: false
      };
      project.suggestions = [suggestion];
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
      toast.success("Job and its files deleted.");
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
        toast.success("Retrying the failed clip render.");
        setActiveJobId(data.job.id);
        void refresh();
      } else {
        toast.error(data.error ?? "Could not retry the failed clip.");
      }
    } catch {
      toast.error("Retry failed. Is the dev server still running?");
    } finally {
      setRetryingJobId(null);
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
        title="Auto Clipper"
        description="Paste a YouTube or Twitch VOD link. The agent reads the transcript and audio energy to find the strongest moments, then renders full-frame 16:9 source clips you can reframe in the editor."
      />

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        {/* Left: add stream + history */}
        <div className="min-w-0 space-y-4">
          <Card>
            <h2 className="text-lg font-semibold text-white">Add a stream</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Paste a YouTube or Twitch VOD link — only the audio and the chosen clip ranges are
              downloaded, so even 90-minute streams process fast.
            </p>
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
                Clip it
              </Button>
            </div>

            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              Clips are rendered as full-frame 16:9 source clips. Open any clip in the editor to reframe, crop,
              caption, and export the final version.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Jobs</h2>
            {!loaded ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">Loading…</p>
            ) : jobs.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Nothing yet. Paste a link above. Each run shows up here with its clips, ready to re-open or delete.
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
                        {new Date(job.createdAt).toLocaleString()} - {job.clips.length} source clips
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
        <div className="min-w-0 space-y-4">
          {!activeJob ? (
            <Card className="flex flex-col items-center gap-3 py-14 text-center">
              <Film className="h-8 w-8 text-[var(--accent)]" />
              <p className="text-sm font-semibold text-white">No job selected</p>
              <p className="max-w-md text-sm text-[var(--muted-foreground)]">
                Paste a VOD link on the left. The agent analyzes audio energy, finds the strongest moments, and renders
                each as a full-frame 16:9 source clip you can reframe in the editor.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-white">{activeJob.fileName}</h2>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {activeJob.durationSec ? `${formatTimestamp(activeJob.durationSec)} long - ` : ""}
                      16:9 source clips
                    </p>
                  </div>
                  {processing && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--accent)]" />}
                </div>

                {!processing && failedClipCount > 0 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/8 p-3">
                    <p className="text-xs leading-relaxed text-amber-100">
                      {failedClipCount} clip{failedClipCount === 1 ? "" : "s"} did not render. Retry only the missing clip
                      {failedClipCount === 1 ? "" : "s"}.
                    </p>
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => void retryFailedRenders(activeJob)}
                      disabled={retryingJobId === activeJob.id}
                    >
                      {retryingJobId === activeJob.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Retry failed clips
                    </Button>
                  </div>
                )}

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
                    <p className="min-w-0 break-words text-sm text-red-200">{activeJob.error}</p>
                  </div>
                )}

                {activeJob.driveFolder && (
                  <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/8 p-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <p className="text-xs leading-relaxed text-emerald-100">
                      Saved to Google Drive · <code>clipping agent/{activeJob.fileName}</code>
                    </p>
                  </div>
                )}

                {activeJob.notices.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {activeJob.notices.map((notice) => (
                      <div key={notice} className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/8 p-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <p className="min-w-0 break-words text-xs leading-relaxed text-amber-100">{notice}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {activeJob.status === "done" && (
                <div className="grid gap-3 md:grid-cols-2">
                  {activeJob.clips.map((clip, index) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      index={index}
                      jobId={activeJob.id}
                      onEdit={() => void editClip(activeJob, clip, index)}
                    />
                  ))}
                </div>
              )}

              {activeJob.status === "done" && activeJob.clips.some((clip) => clip.score > 0) && <ScoreLegend />}
            </>
          )}
        </div>
      </div>
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
  const primaryDownloadUrl = clip.file ? fileUrl(jobId, clip.file, true) : "";
  return (
    <Card className="p-3">
      <div className="flex gap-3">
        {clip.file && (
          <div className="w-32 shrink-0 sm:w-36">
            <video
              src={fileUrl(jobId, clip.file)}
              preload="metadata"
              muted
              playsInline
              className="aspect-video w-full rounded-lg bg-black object-contain ring-1 ring-white/10"
            />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]">#{index + 1}</Badge>
            <Badge>
              {formatTimestamp(clip.start)} – {formatTimestamp(clip.end)}
            </Badge>
            <Badge>{Math.round(clip.end - clip.start)}s</Badge>
            {clip.score > 0 && (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">Score {clip.score}</Badge>
            )}
          </div>

          <p className="line-clamp-2 text-[11px] leading-5 text-[var(--muted-foreground)]">{clip.rationale}</p>

          {clip.score > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {SCORE_GUIDE.map(({ key, label, measures, improve }) => (
                <div key={key} title={`${measures}\n\nHow to raise it: ${improve}`}>
                  <div className="mb-0.5 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
                    <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
                    <span className="text-white">{clip.breakdown[key]}</span>
                  </div>
                  <Progress value={clip.breakdown[key]} className="h-1" />
                </div>
              ))}
            </div>
          )}

          {clip.file && (
            <div className="flex flex-wrap gap-1.5">
              <a
                href={primaryDownloadUrl}
                download={`${jobId}-${clip.file}`}
                className="inline-flex items-center rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-contrast)] transition hover:brightness-110"
              >
                <Download className="mr-1.5 h-3 w-3" />
                Download source
              </a>
              <Button variant="secondary" className="px-2.5 py-1 text-[11px]" onClick={onEdit}>
                <SquarePlay className="mr-1.5 h-3 w-3" />
                Open in editor
              </Button>
            </div>
          )}

        </div>
      </div>
    </Card>
  );
}

/** Always-on reference explaining what every score means and how to raise it. */
function ScoreLegend() {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-white">How these scores work</h2>
      </div>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Each clip is rated 0–100 on four signals measured from its transcript and audio. The overall{" "}
        <span className="text-white">Score</span> weights them Word Density 33%, Hook 28%, Intensity 24%, Standalone 15%.
        When a source has no captions, scores fall back to audio energy only.
      </p>
      <dl className="mt-4 space-y-4">
        {SCORE_GUIDE.map(({ key, label, measures, improve }) => (
          <div key={key} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <dt className="text-sm font-semibold text-white">{label}</dt>
            <dd className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              <span className="text-white/80">What it measures:</span> {measures}
            </dd>
            <dd className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              <span className="text-[var(--accent)]">How to raise it:</span> {improve}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
