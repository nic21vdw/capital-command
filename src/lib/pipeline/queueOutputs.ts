import path from "node:path";
import { renderCarouselDeck } from "@/lib/carousels/renderDeck";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { getProject, projectOutputDir } from "@/lib/longform/store";
import { deckIsPostable, deckRatio } from "@/lib/carousels/deckFiles";
import { getRun, listRuns, updateRun } from "@/lib/pipeline/runs";
import { WHOLE_RUN_FAILURE, type PipelineRun } from "@/lib/pipeline/types";
import { readAppData } from "@/lib/storage/store";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { enqueue, enqueueImagePost } from "@/lib/publisher/enqueue";
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import { shuffled } from "@/lib/publisher/mirror";
import { publishQueue } from "@/lib/publisher/queue";
import { withPublishRunLock } from "@/lib/publisher/runLock";
import { runDue } from "@/lib/publisher/runner";
import { planScheduleRepair } from "@/lib/publisher/scheduleShuffle";
import { generateSlots, slotGrid } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import type { Carousel } from "@/types/domain";

// The last mile. A run that finished left every output sitting in a tool of its
// own: the clips had to be scheduled one at a time in the Uploading Center, and
// the long-form video and its topic segments had no route into the publish
// queue at all — they were downloaded and uploaded by hand. This plans one
// booking for everything a run produced and, on confirmation, books it.
//
// Every item lands in the same queue the Uploading Center writes to, at a
// future slot. Nothing is posted early — but a booking is not a delivery, so
// as soon as the slots are settled the platforms that accept a future post are
// handed theirs (YouTube, Buffer) instead of waiting on the next runner tick.

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

/**
 * There is nothing left to book on this run — the normal state between one
 * output finishing and the next. It is its own type because the standing drain
 * has to tell it apart from a run that could book NOTHING AT ALL: both arrive
 * as a throw, and treating them the same is what let "publishing is off" pass
 * silently while the run still read as finished.
 */
export class NothingWaitingError extends Error {
  constructor() {
    super("Nothing on this run is waiting to be scheduled.");
    this.name = "NothingWaitingError";
  }
}

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

/**
 * And it is not a Short, so it is not measured as one. Booking these as
 * short-form posts met the Shorts length rule in `vertical.ts` and refused
 * every long-form edit the pipeline has ever made — a 352-second video is the
 * point of a long-form upload, not a fault in it.
 */
const LONG_VIDEO_KINDS = new Set<QueueOutputKind>(["longform", "segment"]);

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

/**
 * How far ahead a booking may reach. Three weeks was the whole calendar, and a
 * back catalogue fills that in one sitting: sixteen streams is about a hundred
 * and seventy shorts against sixty-three slots, so every run after the second
 * was refused with "no free slot" while months of empty calendar sat just past
 * the edge. The overflow is still refused rather than stacked — this only
 * decides how much calendar counts as the calendar.
 */

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
  // `bookable`, not `!past`: a run's whole output never lands on the day it was
  // booked, so the earliest slot offered is tomorrow's (see schedule.ts).
  const openSlots = generateSlots({ timeZone: config.timezone, days: config.bookingHorizonDays, ...slotGrid(config) })
    .filter((slot) => slot.bookable && !taken.has(slot.utc))
    .map((slot) => slot.utc);

  return {
    runName: run.name,
    candidates,
    skipped,
    openSlots: openSlots.slice(0, Math.max(candidates.length, 1)),
    enabled: config.enabled,
    problem: config.enabled
      ? config.platforms.length === 0
        ? "No platforms are switched on — choose them in Settings before booking anything."
        : undefined
      : PUBLISHING_OFF_MESSAGE
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

/**
 * One output per free slot, in random order, so a run's shorts are not booked
 * as three clips from the same stream in a row. Two outputs never share a
 * slot: the Uploading Center treats a taken slot as taken, and double-booking
 * is how a day ends up posting twice and another posts nothing.
 */
export function assignSlots(
  candidates: QueueCandidate[],
  slots: string[],
  seed: number = Date.now()
): { candidate: QueueCandidate; publishAt: string | undefined }[] {
  const ordered = shuffled(candidates, seed);
  return ordered.map((candidate, index) => ({ candidate, publishAt: slots[index] }));
}

/**
 * Settles the calendar around what was just booked: clears any slot that would
 * now post one platform twice, and breaks up a stream that landed next to
 * itself. Nothing else moves.
 *
 * This is `planScheduleRepair`, deliberately, and NOT `planScheduleShuffle`.
 * The two planners differ by one number — `moveCost`, 1 against 0 — and on a
 * live calendar that number is everything. A shuffle pays nothing to displace a
 * post, so it is a whole-schedule re-deal: measured against the real 492-item
 * queue it moved 338 of 394 upcoming posts across 88 days, the worst of them
 * from August to November, and it did it with a `Date.now()` seed so no two
 * runs agreed. It also RAN ITSELF — `queueReadyOutputs` reaches this line from
 * the heartbeat every time a segment finishes rendering — and it left 123
 * colliding platform-instants on a queue that had none before it.
 *
 * A repair pays for every post it disturbs, so everything already fine stays
 * exactly where he last read it, and the videos YouTube is already holding a
 * time for are pinned rather than merely deprioritized. It still does what this
 * call was added for: a back-to-back repeat scores 100 against a move cost of
 * 1, so a run's outputs are still separated — with the fewest moves that does
 * it, instead of the most.
 *
 * The open slots are the same grid the booking dealt from, so an overflowing
 * platform gets a later slot rather than stacking onto a day that already
 * posts. `relocate` only ever moves onto an instant whose lane is empty, so a
 * slot this booking just filled cannot be handed out twice.
 */
async function settleSchedule(): Promise<void> {
  const config = publisherConfig();
  const queue = publishQueue(config);
  const now = new Date();
  const upcoming = await queue.list();
  const openSlots = generateSlots({ timeZone: config.timezone, days: config.bookingHorizonDays, now, ...slotGrid(config) })
    .filter((slot) => slot.bookable)
    .map((slot) => slot.utc);
  const fix = planScheduleRepair(upcoming, now, { openSlots });
  if (fix.moves.length === 0) return;
  await queue.applyPublishTimes(
    fix.moves.map((move) => ({ id: move.id, publishAt: move.to })),
    "pipeline-queue-outputs"
  );
}

/**
 * Hands the new bookings to the platforms that will take them early, instead
 * of leaving them for the five-minute runner to notice. Booking a post and
 * delivering it are different things, and until the delivery happens the post
 * exists only in this app: YouTube takes the upload now and shows it in Studio
 * as Scheduled, and Buffer takes its updates now. Nothing here posts anything
 * before its slot — a platform that cannot be handed a future post is left for
 * the runner to post at the time, which is what the board now says it does.
 *
 * Deliberately not awaited: the booking call returns as soon as the queue is
 * written, so the sheet closes at the speed it always did while the uploads
 * run behind it. The run lock means this can never overlap the scheduled
 * runner, and a run already in flight is already doing this work.
 */
function sendWhatCanGoUpNow(): void {
  if (!publisherConfig().enabled) return;
  void withPublishRunLock(() => runDue(new Date()))
    .catch((error: unknown) =>
      console.warn(
        `[pipeline] the publish pass after booking failed — the scheduled runner will pick it up: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
}

/**
 * Books the chosen outputs into the publish queue, one per free slot, in
 * random order so a run does not occupy a week as the same stream. One
 * failure never stops the rest — a run with twelve outputs would otherwise
 * be all-or-nothing on whichever file the hosting bucket choked on.
 *
 * The free slots come from the plan and nowhere else. There used to be a
 * fallback that regenerated thirty days of slots whenever the plan's list came
 * back empty, filtering only `past` and never `taken` — so once the calendar
 * filled, every further booking restacked onto the same earliest slots. Eight
 * clips landed on one 11:30 slot across four platforms each. An empty list is
 * the calendar saying it is full: the overflow gets no slot and reports "No
 * free slot", which is the honest answer.
 */
export async function queueRunOutputs(
  runId: string,
  ids?: string[],
  options: { standing?: boolean; seen?: string[] } = {}
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
  if (chosen.length === 0) throw new NothingWaitingError();
  for (const item of chosen) {
    heldBack.delete(item.id);
    alreadyBooked.delete(item.id);
  }

  // Only a person unticking something creates a held-back id, and only for a
  // row he was actually shown. The sheet is planned when it opens and the run
  // is re-planned when it is confirmed, so an output that became bookable in
  // between — the deck, written from the transcript minutes after the shorts
  // finish, or the long-form export landing last — was never on screen to be
  // unticked. Recording it as one held 26 rendered decks back permanently: the
  // standing drain skips a held-back id forever, so the deck was made, rendered
  // and then silently never booked. `seen` is what the sheet listed; anything
  // outside it is left undecided for the drain to book as it lands.
  const seen = options.seen;
  const droppedNow =
    !options.standing && ids
      ? plan.candidates
          .filter((item) => !ids.includes(item.id) && !item.heldBack && (!seen || seen.includes(item.id)))
          .map((item) => item.id)
      : [];

  const slots = plan.openSlots;
  const horizonMonths = Math.max(1, Math.round(publisherConfig().bookingHorizonDays / 30));

  const queued: QueueResult["queued"] = [];
  // Keyed by candidate so the complaint reads in the order he ticked them,
  // whatever random order the slots were dealt in.
  const problems = new Map<string, QueueResult["failed"][number]>();
  const bookedIds: string[] = [];
  for (const { candidate, publishAt } of assignSlots(chosen, slots)) {
    if (!publishAt) {
      // Naming the way out matters: the grid is his own configuration, not a
      // limit the platforms impose, and "the calendar is full" reads like the
      // latter. PUBLISH_SLOT_TIMES is how a day gets more room.
      problems.set(candidate.id, {
        title: candidate.title,
        error: `Every slot in the next ${horizonMonths} months is taken — add another posting time to fit more into a day.`
      });
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
              runId: run.id,
              metadataSource: { streamTitle: plan.runName },
              by: "pipeline-queue-outputs"
            })
          : await enqueue({
              clipPath: candidate.filePath,
              publishAt,
              title: candidate.title,
              format: LONG_VIDEO_KINDS.has(candidate.kind) ? "long" : "short",
              platforms: candidate.platforms.length ? candidate.platforms : undefined,
              visibility: "public",
              jobId: candidate.kind === "clip" ? candidate.id.split(":")[1] : undefined,
              runId: run.id,
              metadataSource: { streamTitle: plan.runName },
              by: "pipeline-queue-outputs"
            });
      queued.push({
        title: candidate.title,
        publishAt: item.publishAt,
        platforms: Object.keys(item.platforms) as PlatformId[]
      });
      bookedIds.push(candidate.id);
    } catch (error) {
      problems.set(candidate.id, {
        title: candidate.title,
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    // Written HERE, one booking at a time, not once after the loop. The run's
    // record of what it booked used to be persisted only at the end, so a
    // process that died mid-loop — a restart, a release, a killed CLI — left
    // items on the live queue that no run admitted to putting there. That is
    // exactly the state nobody could explain on 2026-08-12, and it cannot be
    // investigated after the fact: the queue says what is scheduled and the run
    // says it booked nothing. A flush per item costs one small write and buys a
    // record that is true at every instant.
    //
    // Outside the try on purpose — a failed flush is not a failed booking, and
    // reporting it as one would put the same output in both lists.
    await updateRun(run, { queueBooked: [...alreadyBooked, ...bookedIds] });
  }
  const failed = chosen.map((candidate) => problems.get(candidate.id)).filter((entry) => entry !== undefined);
  if (queued.length > 0) {
    await settleSchedule();
    sendWhatCanGoUpNow();
  }
  if (bookedIds.length > 0 || droppedNow.length > 0) {
    await updateRun(run, {
      queueBooked: [...alreadyBooked, ...bookedIds],
      queueHeldBack: [...heldBack, ...droppedNow],
      // He is dealing with them now, so the old complaint goes; anything that
      // fails again is recorded again on the next drain. The standing drain
      // clears its own resolved rows in `clearResolvedFailures` instead — it
      // books a few outputs at a time and must not throw away a complaint about
      // one it did not touch.
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
    // A drain that gets as far as choosing candidates has proved the plan is no
    // longer refused, whether or not it found anything left to book.
    let planAccepted = true;
    // "Nothing waiting" is the normal case between one output finishing and the
    // next, and it throws — that is the caller's contract for a button press,
    // not a reason to log anything here. Anything ELSE that throws blocked the
    // whole run before a single failure could be collected, so it is recorded
    // against the run rather than dropped.
    const result = await queueRunOutputs(run.id, undefined, { standing: true }).catch(async (error) => {
      if (error instanceof NothingWaitingError) return null;
      planAccepted = false;
      await recordQueueFailure(run.id, WHOLE_RUN_FAILURE, error instanceof Error ? error.message : String(error));
      return null;
    });
    booked += result?.queued.length ?? 0;
    // Cleared BEFORE the new failures are written, so anything that failed
    // again this time is recorded again rather than cleared by its own retry.
    await clearResolvedFailures(run.id, {
      wholeRun: planAccepted,
      titles: (result?.queued ?? []).map((item) => item.title)
    });
    // A booking that FAILED is different: nobody was watching, and dropping it
    // left the row promising an output the app had quietly given up on.
    for (const failure of result?.failed ?? []) {
      await recordQueueFailure(run.id, failure.title, failure.error);
    }
  }
  return booked;
}

/**
 * Drops the complaints this drain has just answered. Without it the alarm
 * outlives its cause: he turns publishing back on, the next heartbeat books
 * everything, and the badge, the run list and the Scheduler row all still say
 * it failed — while the only button offered answers "nothing is waiting".
 */
export async function clearResolvedFailures(
  runId: string,
  resolved: { wholeRun: boolean; titles: string[] }
): Promise<void> {
  const run = await getRun(runId);
  const failures = run?.queueFailures;
  if (!run || !failures?.length) return;
  const booked = new Set(resolved.titles);
  const kept = failures.filter((failure) =>
    failure.title === WHOLE_RUN_FAILURE ? !resolved.wholeRun : !booked.has(failure.title)
  );
  if (kept.length === failures.length) return;
  await updateRun(run, { queueFailures: kept.length > 0 ? kept : undefined });
}

/**
 * Puts down a failure he has decided to live with. It is a plain delete, not a
 * suppression: something that fails again on the next drain is recorded again,
 * because an alarm for a problem that is still happening is not noise.
 */
export async function dismissQueueFailures(runId: string): Promise<boolean> {
  const run = await getRun(runId);
  if (!run?.queueFailures?.length) return false;
  await updateRun(run, { queueFailures: undefined });
  return true;
}

/** Stops the standing instruction — a settled run has nothing more coming. */
export async function stopQueueingWhenSettled(runId: string, settled: boolean): Promise<void> {
  if (!settled) return;
  const run = await getRun(runId);
  if (run?.queueWhenReady) await updateRun(run, { queueWhenReady: undefined });
}

/** One line about something that could not be booked, deduped so a tick cannot spam it. */
export async function recordQueueFailure(runId: string, title: string, error: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  const seen = new Set((run.queueFailures ?? []).map((item) => `${item.title}:${item.error}`));
  if (seen.has(`${title}:${error}`)) return;
  await updateRun(run, { queueFailures: [...(run.queueFailures ?? []), { title, error }].slice(-10) });
}
