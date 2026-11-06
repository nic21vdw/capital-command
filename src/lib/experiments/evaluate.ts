import { metricsAtAge } from "@/lib/analytics/atAge";
import { engagementRate } from "@/lib/analytics/metrics";
import type { PostRecord } from "@/lib/analytics/types";
import { accountBaselines } from "@/lib/experiments/baselines";
import { spacingConflicts, spacingMessage, type Placement } from "@/lib/experiments/spacing";
import {
  UNMEASURED_GRACE_DAYS,
  type DecisionReason,
  type Experiment,
  type ExperimentDecision,
  type ExperimentKind,
  type ExperimentSource,
  type ExperimentVariant,
  type VariantOrigin
} from "@/lib/experiments/types";
import { chooseWinner, type PostScore, type VariantScore, type WinnerInput } from "@/lib/experiments/winner";
import type { QueueItem } from "@/lib/publisher/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STILL_DUE_WINDOW_MS = DAY;

export type VariantState = "scheduled" | "measuring" | "waiting" | "measured" | "removed" | "failed" | "unmeasured";

export type VariantReport = {
  id: string;
  value: string;
  origin: VariantOrigin;
  state: VariantState;
  publishAt: string | null;
  publishedAt: string | null;
  windowEndsAt: string | null;
  posts: number;
  measuredPosts: number;
  views: number | null;
  viewsIndex: number | null;
  rateIndex: number | null;
  score: number | null;
};

export type ExperimentStatus = "running" | "decided" | "inconclusive";

export type ExperimentReport = {
  id: string;
  kind: ExperimentKind;
  source: ExperimentSource;
  createdAt: string;
  windowHours: number;
  status: ExperimentStatus;
  reason: DecisionReason | null;
  winnerId: string | null;
  summary: string;
  decidedAt: string | null;
  variants: VariantReport[];
};

export type EvaluateInput = {
  experiment: Experiment;
  posts: PostRecord[];
  queueItems: QueueItem[];
  now: Date;
};

type Described = { report: VariantReport; scored: PostScore[] };

const OPEN_LEG: ReadonlySet<string> = new Set(["pending", "uploaded", "scheduled"]);

function legsStillToGoOut(items: QueueItem[], now: Date): boolean {
  return items.some(
    (item) =>
      Date.parse(item.publishAt) > now.getTime() - STILL_DUE_WINDOW_MS &&
      Object.values(item.platforms).some((state) => state && OPEN_LEG.has(state.status))
  );
}

function earliest(values: string[]): string | null {
  return values.length === 0 ? null : [...values].sort()[0];
}

function describeVariant(experiment: Experiment, variant: ExperimentVariant, posts: PostRecord[], queue: Map<string, QueueItem>, now: Date): Described {
  const windowMs = experiment.windowHours * HOUR;
  const itemIds = variant.placements.map((placement) => placement.itemId);
  const own = posts.filter((post) => itemIds.includes(post.itemId));
  const items = itemIds.flatMap((id) => (queue.has(id) ? [queue.get(id)!] : []));
  const plannedAt = earliest([...items.map((item) => item.publishAt), ...variant.placements.map((placement) => placement.publishAt)]);

  const base: VariantReport = {
    id: variant.id,
    value: variant.value,
    origin: variant.origin,
    state: "scheduled",
    publishAt: plannedAt,
    publishedAt: earliest(own.map((post) => post.publishedAt)),
    windowEndsAt: null,
    posts: own.length,
    measuredPosts: 0,
    views: null,
    viewsIndex: null,
    rateIndex: null,
    score: null
  };

  if (own.length === 0) {
    if (items.length === 0) return { report: { ...base, state: "removed" }, scored: [] };
    return { report: { ...base, state: legsStillToGoOut(items, now) ? "scheduled" : "failed" }, scored: [] };
  }

  const lastPublished = Math.max(...own.map((post) => Date.parse(post.publishedAt)));
  const windowEnd = lastPublished + windowMs;
  base.windowEndsAt = new Date(windowEnd).toISOString();
  if (now.getTime() < windowEnd || legsStillToGoOut(items, now)) return { report: { ...base, state: "measuring" }, scored: [] };

  const measurable = own.filter((post) => post.status !== "unsupported" && post.status !== "gone");
  const scored: PostScore[] = [];
  for (const post of measurable) {
    const metrics = metricsAtAge(post, windowMs);
    const views = metrics?.views ?? metrics?.reach;
    if (!metrics || typeof views !== "number") continue;
    scored.push({ variantId: variant.id, platform: post.platform, accountId: post.accountId, views, engagementRate: engagementRate(metrics) });
  }
  const pending = measurable.length - scored.length;
  const overdue = now.getTime() - windowEnd > UNMEASURED_GRACE_DAYS * DAY;
  if (scored.length === 0) return { report: { ...base, state: overdue || measurable.length === 0 ? "unmeasured" : "waiting" }, scored };
  if (pending > 0 && !overdue) return { report: { ...base, state: "waiting" }, scored: [] };
  return { report: { ...base, state: "measured", measuredPosts: scored.length }, scored };
}

function placementsOf(experiment: Experiment, posts: PostRecord[], queue: Map<string, QueueItem>): Placement[] {
  const out: Placement[] = [];
  for (const variant of experiment.variants) {
    for (const placement of variant.placements) {
      const post = posts.find((candidate) => candidate.itemId === placement.itemId && candidate.platform === placement.platform);
      const at = post?.publishedAt ?? queue.get(placement.itemId)?.publishAt ?? placement.publishAt;
      out.push({ variantId: variant.id, platform: placement.platform, accountId: post?.accountId ?? placement.accountId, at });
    }
  }
  return out;
}

type Outcome =
  | { kind: "running"; done: number }
  | { kind: "settled"; status: "decided" | "inconclusive"; reason: DecisionReason; winnerId: string | null; summary: string; scores: VariantScore[] | null };

function inconclusive(reason: DecisionReason, summary: string, scores: VariantScore[] | null = null): Outcome {
  return { kind: "settled", status: "inconclusive", reason, winnerId: null, summary, scores };
}

function conclude(
  experiment: Experiment,
  described: Described[],
  posts: PostRecord[],
  queue: Map<string, QueueItem>,
  baselines: WinnerInput["baselines"]
): Outcome {
  const reports = described.map((entry) => entry.report);
  const gone = reports.filter((entry) => entry.state === "removed" || entry.state === "failed");
  if (gone.length > 0) {
    const ids = gone.map((entry) => entry.id).join(" and ");
    const why = gone.every((entry) => entry.state === "removed") ? "its post was taken off the schedule" : "none of its posts went out";
    return inconclusive("removed", `Variant ${ids} never went out (${why}), so there is nothing to compare.`);
  }
  const conflicts = spacingConflicts(placementsOf(experiment, posts, queue));
  if (conflicts.length > 0) {
    return inconclusive("confounded", `${spacingMessage(conflicts[0])} The result would say more about timing than about the ${experiment.kind}.`);
  }
  const lost = reports.filter((entry) => entry.state === "unmeasured");
  if (lost.length > 0) {
    const ids = lost.map((entry) => entry.id).join(" and ");
    return inconclusive("unmeasured", `Variant ${ids} was never read back from its platform after the ${experiment.windowHours} hour window, so it cannot be compared.`);
  }
  const open = reports.filter((entry) => entry.state !== "measured");
  if (open.length > 0) return { kind: "running", done: reports.length - open.length };

  const result = chooseWinner({
    variantIds: experiment.variants.map((variant) => variant.id),
    posts: described.flatMap((entry) => entry.scored),
    baselines
  });
  if (result.outcome === "winner") {
    return { kind: "settled", status: "decided", reason: "winner", winnerId: result.winnerId, summary: result.message, scores: result.scores };
  }
  return inconclusive(result.outcome === "tie" ? "tie" : "not-enough-data", result.message, result.scores);
}

function applyScores(report: VariantReport, scores: VariantScore[] | null): VariantReport {
  const score = scores?.find((entry) => entry.variantId === report.id);
  if (!score) return report;
  return { ...report, views: score.views, viewsIndex: score.viewsIndex, rateIndex: score.rateIndex, score: score.score };
}

export function evaluateExperiment(input: EvaluateInput): ExperimentReport {
  const { experiment, now } = input;
  const queue = new Map(input.queueItems.map((item) => [item.id, item]));
  const itemIds = new Set(experiment.variants.flatMap((variant) => variant.placements.map((placement) => placement.itemId)));
  const baselines = Object.fromEntries(accountBaselines(input.posts, experiment.windowHours * HOUR, itemIds));
  const described = experiment.variants.map((variant) => describeVariant(experiment, variant, input.posts, queue, now));
  const outcome = conclude(experiment, described, input.posts, queue, baselines);

  const head = {
    id: experiment.id,
    kind: experiment.kind,
    source: experiment.source,
    createdAt: experiment.createdAt,
    windowHours: experiment.windowHours
  };
  const variants = described.map((entry) => applyScores(entry.report, outcome.kind === "settled" ? outcome.scores : null));

  if (experiment.decision) {
    return {
      ...head,
      status: experiment.decision.status,
      reason: experiment.decision.reason,
      winnerId: experiment.decision.winnerId,
      summary: experiment.decision.summary,
      decidedAt: experiment.decision.decidedAt,
      variants
    };
  }
  if (outcome.kind === "running") {
    const waiting = described.filter((entry) => entry.report.state === "scheduled").length;
    const summary =
      outcome.done === 0 && waiting === described.length
        ? `Waiting for the posts to go out, then ${experiment.windowHours} hours to measure each one.`
        : `${outcome.done} of ${described.length} variants have been measured over ${experiment.windowHours} hours.`;
    return { ...head, status: "running", reason: null, winnerId: null, summary, decidedAt: null, variants };
  }
  return { ...head, status: outcome.status, reason: outcome.reason, winnerId: outcome.winnerId, summary: outcome.summary, decidedAt: now.toISOString(), variants };
}

export function newDecisions(input: { experiments: Experiment[]; posts: PostRecord[]; queueItems: QueueItem[]; now: Date }): Map<string, ExperimentDecision> {
  const decisions = new Map<string, ExperimentDecision>();
  for (const experiment of input.experiments) {
    if (experiment.decision) continue;
    const report = evaluateExperiment({ experiment, posts: input.posts, queueItems: input.queueItems, now: input.now });
    if (report.status === "running" || report.reason === null) continue;
    decisions.set(experiment.id, {
      status: report.status,
      reason: report.reason,
      winnerId: report.winnerId,
      summary: report.summary,
      decidedAt: input.now.toISOString()
    });
  }
  return decisions;
}
