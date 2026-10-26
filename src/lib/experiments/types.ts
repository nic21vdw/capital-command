import type { PlatformId } from "@/lib/publisher/types";

export const EXPERIMENT_KINDS = ["title", "hook", "thumbnail"] as const;
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number];

export const BOOKABLE_KINDS: ExperimentKind[] = ["title", "hook"];

export const KIND_LABEL: Record<ExperimentKind, string> = { title: "Title", hook: "Hook", thumbnail: "Thumbnail" };

export type VariantOrigin = "original" | "ai" | "edited";

export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 3;
export const VARIANT_IDS = ["A", "B", "C"] as const;

export const MAX_TITLE_LENGTH = 100;
export const MAX_HOOK_LENGTH = 200;

export const DEFAULT_WINDOW_HOURS = 72;
export const MIN_VARIANT_VIEWS = 100;
export const MIN_BASELINE_POSTS = 5;
export const TIE_MARGIN = 0.1;
export const VIEWS_WEIGHT = 0.7;
export const UNMEASURED_GRACE_DAYS = 7;

export type VariantPlacement = {
  platform: PlatformId;
  accountId: string;
  itemId: string;
  publishAt: string;
};

export type ExperimentVariant = {
  id: string;
  value: string;
  origin: VariantOrigin;
  placements: VariantPlacement[];
};

export type ExperimentSource = {
  label: string;
  jobId?: string;
  clipId?: string;
  file?: string;
  runId?: string;
};

export type DecisionReason = "winner" | "tie" | "not-enough-data" | "removed" | "confounded" | "unmeasured";

export type ExperimentDecision = {
  status: "decided" | "inconclusive";
  reason: DecisionReason;
  winnerId: string | null;
  summary: string;
  decidedAt: string;
};

export type Experiment = {
  id: string;
  createdAt: string;
  kind: ExperimentKind;
  source: ExperimentSource;
  windowHours: number;
  variants: ExperimentVariant[];
  decision?: ExperimentDecision;
};

export type ExperimentsFile = { version: 1; experiments: Experiment[] };

export function emptyExperiments(): ExperimentsFile {
  return { version: 1, experiments: [] };
}
