import {
  AlertTriangle,
  AtSign,
  CalendarClock,
  Check,
  Clapperboard,
  Images,
  Layers,
  Loader2,
  Podcast,
  Radio,
  Scissors,
  Sparkles,
  UploadCloud,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStageKey, PipelineStageStatus } from "@/lib/pipeline/types";

export const STATUS_LABELS: Record<PipelineStageStatus, string> = {
  ready: "Done",
  error: "Stuck",
  running: "Working",
  waiting: "Queued",
  skipped: "Skipped"
};

export const STATUS_TEXT: Record<PipelineStageStatus, string> = {
  ready: "tone-success tone-text",
  error: "tone-danger tone-text",
  running: "text-[var(--accent)]",
  waiting: "text-[var(--muted-foreground)]",
  skipped: "text-[var(--muted-foreground)]"
};

export const NODE_STYLES: Record<PipelineStageStatus, string> = {
  ready: "tone-success tone-edge tone-soft tone-text",
  error: "tone-danger tone-edge tone-soft tone-text",
  running:
    "pipeline-node-live border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]",
  waiting: "border-[var(--border)] bg-[var(--panel)] text-[var(--muted-foreground)] opacity-60",
  skipped: "border-dashed border-[var(--border)] bg-transparent text-[var(--muted-foreground)] opacity-50"
};

// What each stage is called wherever it is named — the row heading, the output
// tile and the "these stopped short" summary must say the same word for the
// same thing.
export const STAGE_TITLES: Record<PipelineStageKey, string> = {
  source: "Stream source",
  longform: "Long-form edit",
  segments: "Topic segments",
  clips: "Short-form clips",
  audio: "Podcast MP3",
  podcast: "Podcast release",
  images: "Carousel images",
  visuals: "Real-frame visual ads",
  posts: "Text-only posts",
  schedule: "Scheduler"
};

export const STAGE_ICONS: Record<PipelineStageKey, LucideIcon> = {
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

export const STAGE_ORDER: PipelineStageKey[] = [
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

export function StatusChip({ status }: { status: PipelineStageStatus }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] font-medium", STATUS_TEXT[status])}>
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "ready" && <Check className="h-3 w-3" />}
      {status === "error" && <AlertTriangle className="h-3 w-3" />}
      {STATUS_LABELS[status]}
    </span>
  );
}
