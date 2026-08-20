import { retryMissingRenders } from "@/lib/clipping/jobs";
import { isExportRendering, startLongformExport } from "@/lib/longform/render";
import { getProject, updateProject } from "@/lib/longform/store";
import { advanceRun, getRun, updateRun } from "@/lib/pipeline/runs";
import { nextSegmentToRender, segmentsRemaining, segmentsRenderable } from "@/lib/pipeline/segments";
import type { RepairableStage } from "@/lib/pipeline/repairable";
import type { PipelineRun } from "@/lib/pipeline/types";

// Un-sticking a run. Every stage in `advanceRun` guards itself with a marker
// ("already exported", "already tried and gave up"), which is what stops a poll
// re-running expensive work forever — and also what stops a failed stage ever
// being tried again. Repairing a stage is clearing that marker and letting the
// run advance itself; nothing here renders anything. What MAY be repaired is
// decided in `repairable.ts` and rides on every overview.

function withoutFailure(run: PipelineRun, key: string): Record<string, number> {
  const { [key]: _cleared, ...rest } = run.failures ?? {};
  return rest;
}

export type RepairResult = { ok: true; stage: RepairableStage; detail: string } | { ok: false; error: string };

async function repairLongform(run: PipelineRun): Promise<RepairResult> {
  // Nothing was ever created — the run gave up trying. Clearing the failure
  // count is the repair; `advanceRun` creates the project on the way out.
  if (!run.longformProjectId) {
    await updateRun(run, { failures: withoutFailure(run, "longform") });
    return { ok: true, stage: "longform", detail: "Making the long-form project again." };
  }
  const project = await getProject(run.longformProjectId);
  if (!project) return { ok: false, error: "The long-form project is gone — it may have been deleted." };
  if (project.status === "processing") {
    return { ok: false, error: "The long-form analysis is still running, so there is nothing to re-export yet." };
  }
  if (project.status === "error") {
    return { ok: false, error: "The long-form analysis itself failed. Retry the analysis in the Long-Form Editor first." };
  }

  // A record still marked `processing` in a process that is not rendering it is
  // a casualty of a restart. Retiring it is what lets a fresh export start —
  // `startLongformExport` refuses while any record claims to be rendering.
  const stranded = project.exports.filter(
    (record) => !record.topicId && record.status === "processing" && !isExportRendering(record.id)
  );
  if (project.exports.some((record) => record.status === "processing" && isExportRendering(record.id))) {
    return { ok: false, error: "An export is rendering right now — let it finish." };
  }
  if (stranded.length > 0) {
    for (const record of stranded) {
      record.status = "canceled";
      record.progress = 0;
      record.error = "Stopped when the server restarted.";
    }
    await updateProject(project.id, { exports: project.exports });
  }

  const fresh = await getProject(project.id);
  if (!fresh) return { ok: false, error: "The long-form project is gone — it may have been deleted." };
  const record = await startLongformExport(fresh);
  // The run pointed at the dead record; the audio step keys off the same id, so
  // clearing the note is what lets the MP3 be cut from the new file.
  await updateRun(run, { longformExportId: record.id, audioNote: undefined, failures: withoutFailure(run, "export") });
  return { ok: true, stage: "longform", detail: "The long-form export is rendering again." };
}

async function repairSegments(run: PipelineRun): Promise<RepairResult> {
  if (!run.longformProjectId) return { ok: false, error: "This run has no long-form project to split into subjects." };
  const project = await getProject(run.longformProjectId);
  if (!project) return { ok: false, error: "The long-form project is gone — it may have been deleted." };
  await updateProject(project.id, { topics: undefined, topicsNote: undefined });
  await updateRun(run, { segmentsPlanned: undefined, failures: withoutFailure(run, "segments") });
  return { ok: true, stage: "segments", detail: "The stream will be split into topic segments again on the next poll." };
}

async function repairClips(run: PipelineRun): Promise<RepairResult> {
  if (!run.clipJobId) {
    await updateRun(run, { failures: withoutFailure(run, "clips") });
    return { ok: true, stage: "clips", detail: "Making the clip job again." };
  }
  const job = await retryMissingRenders(run.clipJobId);
  if (!job) return { ok: false, error: "The clip job is gone — it may have been deleted." };
  if (job.clips.length === 0) {
    return { ok: true, stage: "clips", detail: "No clips were ever planned — the clip job is starting again from the source." };
  }
  if (job.status === "done") {
    return { ok: true, stage: "clips", detail: "Every clip had already rendered — the run is settled." };
  }
  return { ok: true, stage: "clips", detail: "The clips that never rendered are rendering again." };
}

/**
 * One repair, then an advance so the work actually starts rather than waiting
 * for whatever polls next.
 */
export async function repairRun(runId: string, stage: RepairableStage): Promise<RepairResult> {
  const run = await getRun(runId);
  if (!run) return { ok: false, error: `No pipeline run called ${runId}.` };
  if (run.status === "error") {
    return { ok: false, error: "The source never downloaded, so no stage can be retried. Start the run again." };
  }

  let result: RepairResult;
  switch (stage) {
    case "longform":
      result = await repairLongform(run);
      break;
    case "segments":
      result = await repairSegments(run);
      break;
    case "clips":
      result = await repairClips(run);
      break;
    case "audio":
      await updateRun(run, { audioNote: undefined, failures: withoutFailure(run, "audio") });
      result = { ok: true, stage, detail: "The podcast MP3 will be cut from the edit again." };
      break;
    case "images":
      await updateRun(run, {
        carouselId: undefined,
        carouselNote: undefined,
        carouselGaveUp: undefined,
        failures: withoutFailure(run, "carousel")
      });
      result = { ok: true, stage, detail: "The carousel will be written from the transcript again." };
      break;
    case "posts":
      await updateRun(run, {
        posts: undefined,
        postsNote: undefined,
        postsGaveUp: undefined,
        failures: withoutFailure(run, "posts")
      });
      result = { ok: true, stage, detail: "The text posts will be written again." };
      break;
  }

  if (result.ok) {
    // The amber lines above the rows are what went wrong. They only ever
    // accumulated, so a repaired stage went green with its own failure still
    // printed over it. Starting work again clears the record it is retrying.
    if (run.notices.length > 0) await updateRun(run, { notices: [] });
    await advanceRun(run);
  }
  return result;
}

/**
 * Renders one topic segment — the next one with no finished video. Segments are
 * planned automatically but rendered on demand, and the export engine takes one
 * render at a time, so this is deliberately one call per segment.
 */
export async function renderNextSegment(
  runId: string,
  all = false
): Promise<{ ok: true; title: string; remaining: number; queued?: boolean } | { ok: false; error: string }> {
  const run = await getRun(runId);
  if (!run) return { ok: false, error: `No pipeline run called ${runId}.` };
  if (!run.longformProjectId) return { ok: false, error: "This run has no long-form project." };
  const project = await getProject(run.longformProjectId);
  if (!project) return { ok: false, error: "The long-form project is gone — it may have been deleted." };
  const topics = project.topics ?? [];
  if (topics.length === 0) return { ok: false, error: "This stream has no topic segments planned." };
  const remaining = segmentsRemaining(project);
  if (remaining === 0) return { ok: false, error: "Every topic segment has already been rendered." };
  if (segmentsRenderable(project) === 0) {
    return { ok: false, error: "The segments that are left have failed to render twice — open the Long-Form Editor." };
  }

  // "All of them" is a standing instruction on the run, not a batch this
  // request waits on: the export engine renders one at a time, and the advance
  // loop starts the next one as each finishes — with the app closed if need be.
  if (all) await updateRun(run, { renderAllSegments: true });

  const next = nextSegmentToRender(project);
  if (!next) {
    // Nothing started, so nothing came off the count — saying otherwise was a
    // number that did not match what the row showed a second later.
    if (all) return { ok: true, title: "the rest of the segments", remaining, queued: true };
    return { ok: false, error: "Another export is already rendering — segments render one at a time." };
  }
  await startLongformExport(project, { topicId: next.id });
  return { ok: true, title: next.title, remaining: remaining - 1, queued: all };
}

