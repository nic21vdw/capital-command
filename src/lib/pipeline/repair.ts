import { retryMissingRenders } from "@/lib/clipping/jobs";
import { isExportRendering, startLongformExport } from "@/lib/longform/render";
import { getProject, updateProject } from "@/lib/longform/store";
import { advanceRun, getRun, runOverview, updateRun } from "@/lib/pipeline/runs";
import type { PipelineRun, PipelineStage, PipelineStageKey } from "@/lib/pipeline/types";

// Un-sticking a run, from anywhere that can reach it. Every stage in
// `advanceRun` guards itself with a marker ("already exported", "already tried
// and gave up"), which is what stops a poll re-running expensive work forever —
// and also what stops a failed stage ever being tried again. Repairing a stage
// is clearing that marker and letting the run advance itself, never rendering
// anything here.

// `podcast` is deliberately not repairable from here: that stage publishes the
// episode to the feed, and publishing is not something the orchestrator does.

export const REPAIRABLE_STAGES = ["longform", "segments", "clips", "audio", "images", "posts"] as const;

export type RepairableStage = (typeof REPAIRABLE_STAGES)[number];

export function isRepairableStage(value: string): value is RepairableStage {
  return (REPAIRABLE_STAGES as readonly string[]).includes(value);
}

export type StageRepair = { stage: RepairableStage; status: PipelineStage["status"]; detail: string };

/**
 * Which stages are worth another attempt, from the overview alone. A stage that
 * failed or gave up can be retried; one that is ready has nothing to fix, and
 * one still working must be left alone. `longformStalled` covers the case the
 * stage cannot see: an export record left `processing` by a server that stopped
 * mid-render reads as "Rendering the edited video…" forever.
 */
export function repairableStages(
  stages: Record<PipelineStageKey, PipelineStage>,
  options: { longformStalled?: boolean } = {}
): StageRepair[] {
  const repairs: StageRepair[] = [];
  for (const stage of REPAIRABLE_STAGES) {
    const current = stages[stage];
    if (!current) continue;
    const stalled = stage === "longform" && options.longformStalled === true;
    if (current.status === "error" || current.status === "skipped") {
      repairs.push({ stage, status: current.status, detail: current.detail });
    } else if (stalled) {
      repairs.push({ stage, status: "error", detail: "The export stopped when the server restarted." });
    }
  }
  return repairs;
}

export type RepairResult = { ok: true; stage: RepairableStage; detail: string } | { ok: false; error: string };

async function repairLongform(run: PipelineRun): Promise<RepairResult> {
  if (!run.longformProjectId) return { ok: false, error: "This run has no long-form project to re-export." };
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
  await updateRun(run, { longformExportId: record.id, audioNote: undefined });
  return { ok: true, stage: "longform", detail: "The long-form export is rendering again." };
}

async function repairSegments(run: PipelineRun): Promise<RepairResult> {
  if (!run.longformProjectId) return { ok: false, error: "This run has no long-form project to split into subjects." };
  const project = await getProject(run.longformProjectId);
  if (!project) return { ok: false, error: "The long-form project is gone — it may have been deleted." };
  await updateProject(project.id, { topics: undefined, topicsNote: undefined });
  await updateRun(run, { segmentsPlanned: undefined });
  return { ok: true, stage: "segments", detail: "The stream will be split into topic segments again on the next poll." };
}

async function repairClips(run: PipelineRun): Promise<RepairResult> {
  if (!run.clipJobId) return { ok: false, error: "This run has no clip job to retry." };
  const job = await retryMissingRenders(run.clipJobId);
  if (!job) return { ok: false, error: "The clip job is gone — it may have been deleted." };
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
      await updateRun(run, { audioNote: undefined });
      result = { ok: true, stage, detail: "The podcast MP3 will be cut from the edit again." };
      break;
    case "images":
      await updateRun(run, { carouselId: undefined, carouselNote: undefined });
      result = { ok: true, stage, detail: "The carousel will be written from the transcript again." };
      break;
    case "posts":
      await updateRun(run, { posts: undefined, postsNote: undefined });
      result = { ok: true, stage, detail: "The text posts will be written again." };
      break;
  }

  if (result.ok) await advanceRun(run);
  return result;
}

/**
 * Renders one topic segment — the next one with no finished video. Segments are
 * planned automatically but rendered on demand, and the export engine takes one
 * render at a time, so this is deliberately one call per segment.
 */
export async function renderNextSegment(
  runId: string
): Promise<{ ok: true; title: string; remaining: number } | { ok: false; error: string }> {
  const run = await getRun(runId);
  if (!run) return { ok: false, error: `No pipeline run called ${runId}.` };
  if (!run.longformProjectId) return { ok: false, error: "This run has no long-form project." };
  const project = await getProject(run.longformProjectId);
  if (!project) return { ok: false, error: "The long-form project is gone — it may have been deleted." };
  const topics = project.topics ?? [];
  if (topics.length === 0) return { ok: false, error: "This stream has no topic segments planned." };
  if (project.exports.some((record) => record.status === "processing")) {
    return { ok: false, error: "Another export is already rendering — segments render one at a time." };
  }

  const pending = topics.filter(
    (topic) => !project.exports.some((record) => record.topicId === topic.id && record.status === "done" && record.file)
  );
  if (pending.length === 0) return { ok: false, error: "Every topic segment has already been rendered." };

  const next = pending[0];
  await startLongformExport(project, { topicId: next.id });
  return { ok: true, title: next.title, remaining: pending.length - 1 };
}

/** The overview plus what could be repaired on it — what a caller needs to fix a run. */
export async function runDiagnosis(runId: string) {
  const run = await getRun(runId);
  if (!run) return null;
  const overview = await runOverview(run);
  const project = run.longformProjectId ? await getProject(run.longformProjectId) : undefined;
  const exportRecord = project?.exports.find((record) => record.id === run.longformExportId);
  const longformStalled = Boolean(
    exportRecord && exportRecord.status === "processing" && !isExportRendering(exportRecord.id)
  );
  return { overview, repairs: repairableStages(overview.stages, { longformStalled }) };
}
