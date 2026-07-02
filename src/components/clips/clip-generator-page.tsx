"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Clock3,
  Download,
  Film,
  Gauge,
  Info,
  Link as LinkIcon,
  ListVideo,
  Loader2,
  RotateCw,
  Scissors,
  Sparkles,
  SquarePlay,
  Trash2
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
import type { AISuggestion } from "@/types/domain";

const TARGET_CLIP_COUNT = 10;
const EDITOR_DRAFT_PREFIX = "capital-command:clip-editor-draft:";

const STAGE_LABELS: Record<ClipJobStage, string> = {
  downloading: "Downloading source audio",
  analyzing: "Reading transcript",
  selecting: "Selecting moments",
  rendering: "Rendering clips",
  finished: "Ready"
};

const STEPS: Array<{ label: string; stages: ClipJobStage[] }> = [
  { label: "Download", stages: ["downloading"] },
  { label: "Analyze", stages: ["analyzing", "selecting"] },
  { label: "Render", stages: ["rendering"] },
  { label: "Review", stages: ["finished"] }
];

const SCORE_GUIDE: Array<{ key: keyof ClipCandidate["breakdown"]; label: string; measures: string; improve: string }> = [
  {
    key: "hook",
    label: "Hook",
    measures: "How strong the first few seconds are: questions, numbers, direct language, curiosity words, and opening audio energy.",
    improve: "Start on the first real claim, question, or surprising line. Trim filler before it."
  },
  {
    key: "pacing",
    label: "Density",
    measures: "How much useful speech lands per second, with pauses and low-information stretches lowering the score.",
    improve: "Keep the section where the explanation is compact and continuous. Trim dead air before and after the point."
  },
  {
    key: "standalone",
    label: "Context",
    measures: "Whether the clip makes sense without the rest of the stream: clean sentence starts, complete thoughts, and fewer dangling references.",
    improve: "Move the start earlier if it opens on 'this' or 'that'. Move the end later if the point has not resolved."
  },
  {
    key: "intensity",
    label: "Payoff",
    measures: "The emotional or informational punch: loudness, emphasis, decisive language, and whether the moment lands with a clear point.",
    improve: "Favor the moment where the take peaks, the answer lands, or the speaker says the clearest consequence."
  }
];

function formatTimestamp(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDuration(seconds?: number) {
  if (!seconds) return "Unknown length";
  return formatTimestamp(seconds);
}

function fileUrl(jobId: string, fileName: string, download = false) {
  return `/api/clips/${jobId}/files/${encodeURIComponent(fileName)}${download ? "?download=1" : ""}`;
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
  const [submittingUrl, setSubmittingUrl] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null,
    [activeJobId, jobs]
  );
  const processing = activeJob?.status === "processing" || activeJob?.status === "queued";
  const renderedClipCount = activeJob?.clips.filter((clip) => clip.file).length ?? 0;
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

  useEffect(() => {
    if (!jobs.some((job) => job.status === "processing" || job.status === "queued")) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const submitUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      toast.error("Paste a full stream or VOD link starting with http:// or https://.");
      return;
    }
    setSubmittingUrl(true);
    try {
      const response = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, topic: brief.trim() || undefined })
      });
      const data = (await response.json()) as { job?: ClipJob; error?: string };
      if (response.ok && data.job) {
        setActiveJobId(data.job.id);
        setUrl("");
        setBrief("");
        toast.success("Stream queued. The clip generator is selecting 10 moments.");
        void refresh();
      } else {
        toast.error(data.error ?? "Could not start the clip job from that URL.");
      }
    } catch {
      toast.error("Request failed. Is the dev server still running?");
    } finally {
      setSubmittingUrl(false);
    }
  }, [brief, refresh, url]);

  const editClip = useCallback(
    async (job: ClipJob, clip: ClipCandidate, index: number, sourceFile = clip.file) => {
      if (!sourceFile) return;
      const project = makeClipProject({
        jobId: job.id,
        name: `${job.fileName} - clip ${index + 1}`,
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
      toast.success("Stream job and files deleted.");
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
        toast.success("Retrying missing clip renders.");
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

  const currentStepIndex = activeJob
    ? activeJob.status === "done"
      ? STEPS.length - 1
      : STEPS.findIndex((step) => step.stages.includes(activeJob.stage))
    : -1;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="YouTube creator tools"
        title="Clip Generator"
        description="Turn one long stream into 10 ranked source clips, then open the strongest cuts in the editor for captions, reframing, and export."
        actions={
          <div className="grid grid-cols-3 gap-2 text-center">
            <MetricPill label="Target" value={`${TARGET_CLIP_COUNT}`} />
            <MetricPill label="Rendered" value={`${renderedClipCount}`} />
            <MetricPill label="Jobs" value={`${jobs.length}`} />
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)]">
                <Scissors className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-white">New stream</h2>
                <p className="text-xs text-[var(--muted-foreground)]">YouTube, Twitch, or direct VOD URL</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submittingUrl) void submitUrl();
                }}
                disabled={submittingUrl}
              />
              <Textarea
                placeholder="Optional focus: trading mistakes, best stories, spicy takes..."
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                disabled={submittingUrl}
                className="min-h-20"
              />
              <Button onClick={() => void submitUrl()} disabled={submittingUrl || !url.trim()} className="w-full">
                {submittingUrl ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                Generate 10 clips
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ListVideo className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-base font-semibold text-white">Stream queue</h2>
              </div>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void refresh()}>
                <RotateCw className="mr-1 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
            {!loaded ? (
              <p className="text-sm text-[var(--muted-foreground)]">Loading jobs...</p>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No streams yet.</p>
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
                          {new Date(job.createdAt).toLocaleString()} - {job.clips.length || TARGET_CLIP_COUNT} clips
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
                Paste a link to generate ranked clips and open any result in the editor.
              </p>
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={statusClass(activeJob.status)}>{statusLabel(activeJob)}</Badge>
                      <Badge>{formatDuration(activeJob.durationSec)}</Badge>
                      {activeJob.topic && <Badge>{activeJob.topic}</Badge>}
                    </div>
                    <h2 className="mt-3 truncate text-2xl font-semibold text-white">{activeJob.fileName}</h2>
                    <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{activeJob.sourceUrl}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {failedClipCount > 0 && activeJob.status !== "processing" && activeJob.status !== "queued" && (
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
                    {activeJob.status !== "processing" && activeJob.status !== "queued" && (
                      <Button variant="danger" onClick={() => void removeJob(activeJob)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <StatusStat icon={<Sparkles className="h-4 w-4" />} label="Clip target" value={`${activeJob.clips.length || TARGET_CLIP_COUNT}/${TARGET_CLIP_COUNT}`} />
                  <StatusStat icon={<Gauge className="h-4 w-4" />} label="Best score" value={String(Math.max(0, ...activeJob.clips.map((clip) => clip.score)))} />
                  <StatusStat icon={<Clock3 className="h-4 w-4" />} label="Rendered" value={`${renderedClipCount}/${activeJob.clips.length || TARGET_CLIP_COUNT}`} />
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-4">
                  {STEPS.map((step, index) => {
                    const done = activeJob.status === "done" || index < currentStepIndex;
                    const current = index === currentStepIndex && activeJob.status !== "done";
                    return (
                      <div
                        key={step.label}
                        className={cn(
                          "rounded-lg border px-3 py-2",
                          done
                            ? "border-emerald-400/25 bg-emerald-400/10"
                            : current
                              ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
                              : "border-white/10 bg-black/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                              done
                                ? "bg-emerald-400 text-black"
                                : current
                                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                                  : "bg-white/10 text-[var(--muted-foreground)]"
                            )}
                          >
                            {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                          </span>
                          <span className={cn("text-xs font-medium", done || current ? "text-white" : "text-[var(--muted-foreground)]")}>
                            {step.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
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

              {activeJob.status === "done" && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-white">Ranked clips</h2>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {renderedClipCount} rendered source clip{renderedClipCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    {failedClipCount > 0 && (
                      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
                        {failedClipCount} missing render{failedClipCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-3 2xl:grid-cols-2">
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
                  {activeJob.clips.some((clip) => clip.score > 0) && <ScoreLegend />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
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
  const primaryDownloadUrl = clip.file ? fileUrl(jobId, clip.file, true) : "";
  const duration = Math.round(clip.end - clip.start);

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid min-h-full md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="relative bg-black">
          {clip.file ? (
            <video
              src={fileUrl(jobId, clip.file)}
              preload="metadata"
              muted
              playsInline
              className="aspect-video h-full min-h-36 w-full object-contain md:aspect-auto"
            />
          ) : (
            <div className="flex aspect-video h-full min-h-36 w-full items-center justify-center text-sm text-[var(--muted-foreground)] md:aspect-auto">
              Render missing
            </div>
          )}
          <Badge className="absolute left-3 top-3 border-[var(--accent)]/30 bg-black/70 text-[var(--accent)]">
            #{index + 1}
          </Badge>
        </div>
        <div className="min-w-0 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-base font-semibold text-white">{clipHeadline(clip, index)}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>
                  {formatTimestamp(clip.start)} - {formatTimestamp(clip.end)}
                </Badge>
                <Badge>{duration}s</Badge>
                {clip.score > 0 && (
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">Score {clip.score}</Badge>
                )}
              </div>
            </div>
          </div>

          <p className="line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">{clip.rationale}</p>

          {clip.score > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {SCORE_GUIDE.map(({ key, label, measures, improve }) => (
                <div key={key} title={`${measures}\n\nHow to improve: ${improve}`}>
                  <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
                    <span>{label}</span>
                    <span className="text-white">{clip.breakdown[key]}</span>
                  </div>
                  <Progress value={clip.breakdown[key]} className="h-1.5" />
                </div>
              ))}
            </div>
          )}

          {clip.file && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onEdit}>
                <SquarePlay className="mr-1.5 h-3.5 w-3.5" />
                Open in editor
              </Button>
              <a
                href={primaryDownloadUrl}
                download={`${jobId}-${clip.file}`}
                className="inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)] transition hover:bg-[var(--accent-strong)]"
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

function ScoreLegend() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="text-base font-semibold text-white">Scoring guide</h2>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        {SCORE_GUIDE.map(({ key, label, measures, improve }) => (
          <div key={key} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-medium text-white">{label}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              <span className="text-white/80">Measures:</span> {measures}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
              <span className="text-[var(--accent)]">Improve:</span> {improve}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
