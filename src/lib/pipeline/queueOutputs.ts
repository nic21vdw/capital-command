import path from "node:path";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { getProject, projectOutputDir } from "@/lib/longform/store";
import { getRun, listRuns, updateRun } from "@/lib/pipeline/runs";
import type { PipelineRun } from "@/lib/pipeline/types";
import { publisherConfig } from "@/lib/publisher/config";
import { enqueue } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";
import { generateSlots } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

// The last mile. A run that finished left every output sitting in a tool of its
// own: the clips had to be scheduled one at a time in the Uploading Center, and
// the long-form video and its topic segments had no route into the publish
// queue at all — they were downloaded and uploaded by hand. This plans one
// booking for everything a run produced and, on confirmation, books it.
//
// Nothing here publishes. Every item lands in the same queue the Uploading
// Center writes to, at a future slot, for the publish runner to post.

export type QueueOutputKind = "clip" | "longform" | "segment";

export type QueueCandidate = {
  /** Stable across a plan and its confirmation, so a row can be opted out. */
  id: string;
  kind: QueueOutputKind;
  title: string;
  /** Absolute path of the file that would be posted. */
  filePath: string;
  platforms: PlatformId[];
  /** Why this one is not offered, when it is not. */
  blocked?: string;
};

export type QueuePlan = {
  runName: string;
  candidates: QueueCandidate[];
  /** Outputs deliberately left out, with the reason, so nothing vanishes silently. */
  skipped: { title: string; reason: string }[];
  /** Free slots, in order, the confirmation would book into. */
  openSlots: string[];
  enabled: boolean;
  /** Why nothing can be booked at all (publishing switched off, no platforms). */
  problem?: string;
};

export type QueueResult = {
  queued: { title: string; publishAt: string; platforms: PlatformId[] }[];
  failed: { title: string; error: string }[];
};

/**
 * A long-form edit or a ten-minute topic segment is not a short. Posting one to
 * TikTok or a Reel would be rejected on length, so long video only ever goes to
 * the platforms that take it.
 */
const LONG_VIDEO_PLATFORMS: PlatformId[] = ["youtube"];

function queuedPaths(items: QueueItem[]): Set<string> {
  const paths = new Set<string>();
  for (const item of items) {
    for (const value of [item.clipPath, item.sourceClipPath]) {
      if (value) paths.add(path.resolve(process.cwd(), value).toLowerCase());
    }
  }
  return paths;
}

/**
 * The live queue, or a thrown error. An empty list on a failed read would empty
 * `alreadyQueued` and make every output look unscheduled — one unlucky read and
 * the button books the whole run a second time.
 */
async function readQueue(): Promise<QueueItem[]> {
  const config = publisherConfig();
  if (!config.enabled) return [];
  return publishQueue(config).list();
}

/** Everything this run made that could be posted, minus what is already booked. */
export async function planRunOutputs(runId: string): Promise<QueuePlan | null> {
  const run = await getRun(runId);
  if (!run) return null;

  const config = publisherConfig();
  const existing = await readQueue();
  const alreadyQueued = queuedPaths(existing);
  const candidates: QueueCandidate[] = [];
  const skipped: { title: string; reason: string }[] = [];

  await collectClips(run, alreadyQueued, candidates, skipped);
  await collectLongform(run, alreadyQueued, candidates, skipped);

  const taken = new Set(existing.map((item) => item.publishAt));
  const openSlots = generateSlots({ timeZone: config.timezone, days: 21 })
    .filter((slot) => !slot.past && !taken.has(slot.utc))
    .map((slot) => slot.utc);

  return {
    runName: run.name,
    candidates,
    skipped,
    openSlots: openSlots.slice(0, Math.max(candidates.length, 1)),
    enabled: config.enabled,
    problem: config.enabled
      ? config.platforms.length === 0
        ? "No platforms are switched on — set PUBLISH_PLATFORMS in .env."
        : undefined
      : "Publishing is switched off — set PUBLISH_ENABLED=true in .env."
  };
}

async function collectClips(
  run: PipelineRun,
  alreadyQueued: Set<string>,
  candidates: QueueCandidate[],
  skipped: { title: string; reason: string }[]
) {
  if (!run.clipJobId) return;
  const job = await getJob(run.clipJobId);
  if (!job) return;
  const dir = outputDir(job.id);
  for (const clip of job.clips) {
    const file = clip.downloadFile ?? clip.editedFile ?? clip.file;
    const title = clip.title ?? `Clip ${clip.id}`;
    if (!file) {
      skipped.push({ title, reason: "No rendered file yet." });
      continue;
    }
    const filePath = path.resolve(dir, file);
    if (alreadyQueued.has(filePath.toLowerCase())) {
      skipped.push({ title, reason: "Already scheduled." });
      continue;
    }
    candidates.push({
      id: `clip:${job.id}:${clip.id}`,
      kind: "clip",
      title,
      filePath,
      platforms: []
    });
  }
}

async function collectLongform(
  run: PipelineRun,
  alreadyQueued: Set<string>,
  candidates: QueueCandidate[],
  skipped: { title: string; reason: string }[]
) {
  if (!run.longformProjectId) return;
  const project = await getProject(run.longformProjectId);
  if (!project) return;
  const dir = projectOutputDir(project.id);
  for (const record of project.exports) {
    if (record.status !== "done" || !record.file) continue;
    const isSegment = Boolean(record.topicId);
    if (!isSegment && record.id !== run.longformExportId) continue;
    const topic = isSegment ? project.topics?.find((item) => item.id === record.topicId) : undefined;
    const title = record.title ?? topic?.title ?? run.name;
    const filePath = path.resolve(dir, record.file);
    if (alreadyQueued.has(filePath.toLowerCase())) {
      skipped.push({ title, reason: "Already scheduled." });
      continue;
    }
    candidates.push({
      id: `${isSegment ? "segment" : "longform"}:${project.id}:${record.id}`,
      kind: isSegment ? "segment" : "longform",
      title,
      filePath,
      platforms: LONG_VIDEO_PLATFORMS
    });
  }
}

const BOOKING_ORDER: Record<QueueOutputKind, number> = { longform: 0, segment: 1, clip: 2 };

/**
 * One output per free slot, longest video first so the long-form edit lands
 * before the shorts cut out of it. Two outputs never share a slot: the
 * Uploading Center treats a taken slot as taken, and double-booking is how a
 * day ends up posting twice and another posts nothing.
 */
export function assignSlots(
  candidates: QueueCandidate[],
  slots: string[]
): { candidate: QueueCandidate; publishAt: string | undefined }[] {
  const ordered = [...candidates].sort((a, b) => BOOKING_ORDER[a.kind] - BOOKING_ORDER[b.kind]);
  return ordered.map((candidate, index) => ({ candidate, publishAt: slots[index] }));
}

/**
 * Books the chosen outputs into the publish queue, one per free slot, longest
 * video first so the long-form edit lands before the shorts that came out of
 * it. One failure never stops the rest — a run with twelve outputs would
 * otherwise be all-or-nothing on whichever file the hosting bucket choked on.
 */
export async function queueRunOutputs(
  runId: string,
  ids?: string[],
  options: { standing?: boolean } = {}
): Promise<QueueResult> {
  const run = await getRun(runId);
  if (!run) throw new Error(`No pipeline run called ${runId}.`);
  const plan = await planRunOutputs(runId);
  if (!plan) throw new Error(`No pipeline run called ${runId}.`);
  if (plan.problem) throw new Error(plan.problem);

  // A person's choice is remembered, not re-derived. The standing instruction
  // re-plans from scratch every couple of minutes, so without this it books the
  // outputs he unticked — and re-books anything he later deleted from the
  // queue, since the only other dedupe is by file path.
  const heldBack = new Set(run.queueHeldBack ?? []);
  const alreadyBooked = new Set(run.queueBooked ?? []);
  const eligible = plan.candidates.filter(
    (item) => !heldBack.has(item.id) && !alreadyBooked.has(item.id)
  );
  const chosen = ids?.length ? eligible.filter((item) => ids.includes(item.id)) : eligible;
  if (chosen.length === 0) throw new Error("Nothing on this run is waiting to be scheduled.");

  // Only a person unticking something creates a held-back id. The drain has no
  // opinion about what it did not book.
  const droppedNow =
    !options.standing && ids
      ? eligible.filter((item) => !ids.includes(item.id)).map((item) => item.id)
      : [];

  const slots = plan.openSlots.length
    ? plan.openSlots
    : generateSlots({ timeZone: publisherConfig().timezone, days: 30 })
        .filter((slot) => !slot.past)
        .map((slot) => slot.utc);

  const queued: QueueResult["queued"] = [];
  const failed: QueueResult["failed"] = [];
  const bookedIds: string[] = [];
  for (const { candidate, publishAt } of assignSlots(chosen, slots)) {
    if (!publishAt) {
      failed.push({ title: candidate.title, error: "No free slot in the next three weeks." });
      continue;
    }
    try {
      const item = await enqueue({
        clipPath: candidate.filePath,
        publishAt,
        title: candidate.title,
        platforms: candidate.platforms.length ? candidate.platforms : undefined,
        visibility: "public",
        jobId: candidate.kind === "clip" ? candidate.id.split(":")[1] : undefined,
        metadataSource: { streamTitle: plan.runName }
      });
      queued.push({
        title: candidate.title,
        publishAt: item.publishAt,
        platforms: Object.keys(item.platforms) as PlatformId[]
      });
      bookedIds.push(candidate.id);
    } catch (error) {
      failed.push({ title: candidate.title, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (bookedIds.length > 0 || droppedNow.length > 0) {
    await updateRun(run, {
      queueBooked: [...alreadyBooked, ...bookedIds],
      queueHeldBack: [...heldBack, ...droppedNow]
    });
  }
  return { queued, failed };
}

/**
 * Books whatever has become ready on the runs that asked to keep booking. The
 * click that schedules a run's outputs happens while its topic segments are
 * still rendering, so without this he has to come back for each one — and the
 * long-form export often lands after the shorts do.
 *
 * Runs from the server heartbeat, so it works with the app closed. Every book
 * is deduped by file path against the live queue, so a run that already had
 * everything queued costs one queue read and nothing else.
 */
export async function queueReadyOutputs(): Promise<number> {
  const runs = await listRuns();
  const waiting = runs.filter((run) => run.queueWhenReady && run.status === "running");
  let booked = 0;
  for (const run of waiting) {
    // "Nothing waiting" is the normal case between one output finishing and the
    // next, and it throws — that is the caller's contract for a button press,
    // not a reason to log anything here.
    const result = await queueRunOutputs(run.id, undefined, { standing: true }).catch(() => null);
    booked += result?.queued.length ?? 0;
  }
  return booked;
}

/** Stops the standing instruction — a settled run has nothing more coming. */
export async function stopQueueingWhenSettled(runId: string, settled: boolean): Promise<void> {
  if (!settled) return;
  const run = await getRun(runId);
  if (run?.queueWhenReady) await updateRun(run, { queueWhenReady: undefined });
}
