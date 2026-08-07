import path from "node:path";
import { renderCarouselDeck } from "@/lib/carousels/renderDeck";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { getProject, projectOutputDir } from "@/lib/longform/store";
import { deckIsPostable, deckRatio } from "@/lib/carousels/deckFiles";
import { getRun, listRuns, updateRun } from "@/lib/pipeline/runs";
import type { PipelineRun } from "@/lib/pipeline/types";
import { readAppData } from "@/lib/storage/store";
import { publisherConfig } from "@/lib/publisher/config";
import { enqueue, enqueueImagePost } from "@/lib/publisher/enqueue";
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import { publishQueue } from "@/lib/publisher/queue";
import { generateSlots } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import type { Carousel } from "@/types/domain";

// The last mile. A run that finished left every output sitting in a tool of its
// own: the clips had to be scheduled one at a time in the Uploading Center, and
// the long-form video and its topic segments had no route into the publish
// queue at all — they were downloaded and uploaded by hand. This plans one
// booking for everything a run produced and, on confirmation, books it.
//
// Nothing here publishes. Every item lands in the same queue the Uploading
// Center writes to, at a future slot, for the publish runner to post.

export type QueueOutputKind = "clip" | "longform" | "segment" | "carousel";

export type QueueCandidate = {
  /** Stable across a plan and its confirmation, so a row can be opted out. */
  id: string;
  kind: QueueOutputKind;
  title: string;
  /** Absolute path of the file that would be posted. */
  filePath: string;
  /**
   * Every picture of an image post, in slide order. `filePath` is the first of
   * them, which is also what the queue item records as its `clipPath` — so the
   * "already scheduled" check works on a deck exactly as it does on a video.
   */
  imagePaths?: string[];
  platforms: PlatformId[];
  /** Why this one is not offered, when it is not. */
  blocked?: string;
  /**
   * Present when he already decided about this one: `"unticked"` when he held
   * it back at the sheet, `"removed"` when it was booked and has since left the
   * queue. It is still LISTED — offering nothing at all is how the sheet ended
   * up showing an output it would then refuse to book — but it starts unticked,
   * and ticking it is what clears the decision.
   */
  heldBack?: "unticked" | "removed";
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
    for (const value of [item.clipPath, item.sourceClipPath, ...(item.imagePaths ?? [])]) {
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
  await collectCarousel(run, alreadyQueued, candidates, skipped);

  // What he has already decided about stays on the list, marked. The plan used
  // to say nothing about it while the booker refused it, so the sheet listed an
  // output, ticked it, and then answered "nothing is waiting to be scheduled".
  const heldBack = new Set(run.queueHeldBack ?? []);
  const booked = new Set(run.queueBooked ?? []);
  for (const candidate of candidates) {
    if (heldBack.has(candidate.id)) candidate.heldBack = "unticked";
    else if (booked.has(candidate.id)) candidate.heldBack = "removed";
  }

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

/**
 * Whether the run's deck can be booked, given the slide files that were
 * rendered for it. Split out from the disk work so the ceiling and the dedupe
 * are checkable on their own.
 */
export function carouselCandidate(input: {
  carousel: Pick<Carousel, "id" | "title" | "slides" | "aspectRatio">;
  files: string[];
  alreadyQueued: Set<string>;
}): { candidate?: QueueCandidate; skipped?: { title: string; reason: string } } {
  const { carousel, files, alreadyQueued } = input;
  const title = carousel.title || "Carousel";
  if (carousel.slides.length === 0) return {};
  // A story-shaped deck is a shape no picture post carries. Refusing it here is
  // the whole point of planning: the alternative is a post that fails at its
  // slot, hours after anyone could have picked a different frame.
  const ratio = deckRatio(carousel);
  if (!deckIsPostable(ratio)) {
    return {
      skipped: {
        title,
        reason: `A ${ratio} deck is the wrong shape for a picture post — rebuild it as portrait, square or landscape to book it.`
      }
    };
  }
  if (carousel.slides.length > MAX_IMAGES_PER_POST) {
    return {
      skipped: {
        title,
        reason: `A picture post carries at most ${MAX_IMAGES_PER_POST} slides — this deck has ${carousel.slides.length}.`
      }
    };
  }
  if (files.length === 0) return { skipped: { title, reason: "No rendered slides yet." } };
  if (alreadyQueued.has(files[0].toLowerCase())) return { skipped: { title, reason: "Already scheduled." } };
  return {
    candidate: {
      id: `carousel:${carousel.id}`,
      kind: "carousel",
      title,
      filePath: files[0],
      imagePaths: files,
      // Left empty so the booking falls back to whichever switched-on platforms
      // can carry a picture; naming them here would make YouTube an error.
      platforms: []
    }
  };
}

async function collectCarousel(
  run: PipelineRun,
  alreadyQueued: Set<string>,
  candidates: QueueCandidate[],
  skipped: { title: string; reason: string }[]
) {
  if (!run.carouselId) return;
  const data = await readAppData().catch(() => null);
  const carousel = data?.videoStudio?.carousels.find((entry) => entry.id === run.carouselId);
  if (!carousel) return;

  // Rendering is what makes the deck postable at all — nothing else in the app
  // writes a slide to disk. It is idempotent, so the standing instruction
  // re-planning every couple of minutes repaints nothing.
  let files: string[];
  try {
    files = await renderCarouselDeck(carousel);
  } catch (error) {
    skipped.push({
      title: carousel.title || "Carousel",
      reason: `Could not render the slides — ${error instanceof Error ? error.message : String(error)}`
    });
    return;
  }

  const result = carouselCandidate({ carousel, files, alreadyQueued });
  if (result.candidate) candidates.push(result.candidate);
  if (result.skipped) skipped.push(result.skipped);
}

const BOOKING_ORDER: Record<QueueOutputKind, number> = { longform: 0, segment: 1, clip: 2, carousel: 3 };

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
  // Asking for one by id overrides an earlier decision — that is what ticking a
  // held-back row means. The standing drain never asks by id, so it can only
  // ever book what he has not decided against.
  const eligible = ids?.length
    ? plan.candidates.filter((item) => ids.includes(item.id))
    : plan.candidates.filter((item) => !heldBack.has(item.id) && !alreadyBooked.has(item.id));
  const chosen = eligible;
  if (chosen.length === 0) throw new Error("Nothing on this run is waiting to be scheduled.");
  for (const item of chosen) {
    heldBack.delete(item.id);
    alreadyBooked.delete(item.id);
  }

  // Only a person unticking something creates a held-back id. The drain has no
  // opinion about what it did not book.
  const droppedNow =
    !options.standing && ids
      ? plan.candidates.filter((item) => !ids.includes(item.id) && !item.heldBack).map((item) => item.id)
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
      const item =
        candidate.kind === "carousel"
          ? await enqueueImagePost({
              imagePaths: candidate.imagePaths ?? [candidate.filePath],
              publishAt,
              title: candidate.title,
              platforms: candidate.platforms.length ? candidate.platforms : undefined,
              visibility: "public",
              metadataSource: { streamTitle: plan.runName }
            })
          : await enqueue({
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
      queueHeldBack: [...heldBack, ...droppedNow],
      // He is dealing with them now, so the old complaint goes; anything that
      // fails again is recorded again on the next drain.
      ...(options.standing ? {} : { queueFailures: failed.length > 0 ? failed : undefined })
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
    // A booking that FAILED is different: nobody was watching, and dropping it
    // left the row promising an output the app had quietly given up on.
    if (result?.failed.length) {
      const current = await getRun(run.id);
      if (current) {
        const seen = new Set((current.queueFailures ?? []).map((item) => `${item.title}:${item.error}`));
        const added = result.failed.filter((item) => !seen.has(`${item.title}:${item.error}`));
        if (added.length > 0) {
          await updateRun(current, { queueFailures: [...(current.queueFailures ?? []), ...added].slice(-10) });
        }
      }
    }
  }
  return booked;
}

/** Stops the standing instruction — a settled run has nothing more coming. */
export async function stopQueueingWhenSettled(runId: string, settled: boolean): Promise<void> {
  if (!settled) return;
  const run = await getRun(runId);
  if (run?.queueWhenReady) await updateRun(run, { queueWhenReady: undefined });
}
