import type { PipelineRunOverview, PipelineStage, PipelineStageKey } from "@/lib/pipeline/types";

/**
 * What one run looks like at a glance, for the list on the home screen.
 *
 * The list used to say "Finished" and nothing else, so the only way to learn
 * that a stream had produced ten shorts and booked none of them was to open it.
 * Everything here is computed from the overview the poll already carries.
 */

export type RunProgress = {
  /** Stages that will never do anything more, out of all of them. */
  percent: number;
  done: number;
  total: number;
  /** What the run actually made, in the order it makes it. */
  outputs: string[];
  /** Where those outputs got to on the way out. */
  delivery: string;
};

const SETTLED = new Set(["ready", "skipped", "error"]);

function settledStages(stages: Record<PipelineStageKey, PipelineStage>): number {
  return Object.values(stages).filter((stage) => SETTLED.has(stage.status)).length;
}

export function runProgress(entry: PipelineRunOverview): RunProgress {
  const stages = Object.values(entry.stages);
  const done = settledStages(entry.stages);
  const total = stages.length;
  const counts = entry.schedulable;
  const outputs = [
    counts.clipsReady > 0 ? `${counts.clipsReady} short${counts.clipsReady === 1 ? "" : "s"}` : "",
    counts.longformReady ? "long-form" : "",
    counts.segmentsRendered > 0
      ? `${counts.segmentsRendered} segment${counts.segmentsRendered === 1 ? "" : "s"}`
      : "",
    counts.audioReady ? (counts.podcastPublished ? "podcast" : "MP3") : "",
    counts.carouselSlides > 0 ? `${counts.carouselSlides}-slide carousel` : "",
    counts.posts > 0 ? `${counts.posts} post${counts.posts === 1 ? "" : "s"}` : ""
  ].filter(Boolean);

  return {
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    done,
    total,
    outputs,
    delivery: deliveryLine(entry)
  };
}

/**
 * Scheduling in one phrase. "Nothing scheduled" is only ever said about a run
 * that HAS something to schedule — on a run still making its first output it
 * would read as a failure rather than as the normal state of a young run.
 */
export function deliveryLine(entry: PipelineRunOverview): string {
  const { booked, posted, uploading, failed } = entry.delivery;
  if (booked === 0) {
    const made =
      entry.schedulable.clipsReady +
      (entry.schedulable.longformReady ? 1 : 0) +
      entry.schedulable.segmentsRendered +
      (entry.schedulable.carouselSlides > 0 ? 1 : 0);
    return made > 0 ? "Nothing scheduled yet" : "";
  }
  const parts = [`${booked} scheduled`];
  if (posted > 0) parts.push(`${posted} live`);
  if (uploading > 0) parts.push(`${uploading} uploaded`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}
