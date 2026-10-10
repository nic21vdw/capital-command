import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId } from "@/lib/publisher/types";
import {
  targetPlatforms,
  type ClipDraft,
  type PlatformTarget,
  type ReadyClip
} from "@/components/uploading-center/use-uploading-center";

/**
 * The bulk paths through a run of clips — which clips still need a caption, and
 * which slot each unscheduled clip should take. Both are pure so the ordering
 * (and the "no two clips on one slot" rule) is tested without a browser.
 */

export type BulkContext = {
  clips: ReadyClip[];
  draftFor: (clip: ReadyClip) => ClipDraft;
  /** True when the clip already has posts on the queue. */
  isScheduled: (clip: ReadyClip) => boolean;
};

/**
 * Clips a bulk caption pass should write, in the order they appear on screen:
 * every unscheduled clip whose caption is still empty. A clip with a caption —
 * typed, AI-written or restored from a previous session — is left alone, so
 * running it twice never overwrites work.
 */
export function clipsNeedingCaption({ clips, draftFor, isScheduled }: BulkContext): ReadyClip[] {
  return clips.filter((clip) => !isScheduled(clip) && !draftFor(clip).caption.trim());
}

/**
 * Names clips in a sentence — “A”, “B” and 2 more — so a failure says which
 * clips it happened to rather than just how many. Beyond three it counts, or a
 * twelve-clip run produces a toast nobody reads.
 */
export function nameClips(headlines: string[], limit = 3): string {
  const shown = headlines.slice(0, limit).map((headline) => `“${headline}”`);
  const rest = headlines.length - shown.length;
  if (rest > 0) shown.push(`${rest} more`);
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * The daily short-form cap `enqueue` enforces (shortsCap.ts), as the plan needs
 * it: the limit, and how many shorts each local day already holds (that is
 * `shortsByDay` over the whole queue, every platform and account). The server
 * counts distinct VIDEOS, so a clip booked to all platforms is one short.
 */
export type ShortsCap = {
  limit: number;
  /** Local day (YYYY-MM-DD in the publish timezone) -> distinct short videos already booked. */
  booked: ReadonlyMap<string, number>;
};

export type AutoAssignPlan = {
  assignments: Array<{ clip: ReadyClip; draft: ClipDraft }>;
  /** Clips with nowhere to go because the window ran out of free slots. */
  unslotted: number;
  /**
   * Of `unslotted`, the clips that did have an open slot but only on days
   * already at the shorts-a-day limit. Lets the caller say "the days are full"
   * rather than "no slots", which sends him to the wrong fix.
   */
  capBlocked: number;
  /** Clips deliberately left alone — their AI caption failed. */
  heldBack: ReadyClip[];
};

/**
 * Pairs every unscheduled clip with the next slot that is open on all of its
 * target platforms. Slots taken inside this batch are tracked as they are
 * handed out, so two clips can never land on the same time.
 *
 * `skipKeys` holds clips back rather than scheduling them: a clip whose AI
 * caption failed would otherwise go out with fallback copy, and the caller has
 * no way to tell that apart from a clip that was captioned properly.
 */
/**
 * How many clips pressing "schedule everything" would ACTUALLY book.
 *
 * The button used to count every unscheduled clip, which is the set the plan
 * STARTS from, not the set it books: a clip whose caption failed is held back,
 * and a clip with no free slot left is dropped. So the screen said "Schedule 6
 * clips" directly above a warning that 2 of them would not be booked, and then
 * booked 4. Counting through the real plan is the only way the label and the
 * click cannot disagree.
 */
export function autoAssignableCount(
  context: BulkContext & {
    slots: ScheduleSlot[];
    isTargetSlotTaken: (target: PlatformTarget, slotUtc: string) => boolean;
    skipKeys?: ReadonlySet<string>;
    shortsCap?: ShortsCap;
  }
): number {
  return planAutoAssign(context).assignments.length;
}

export function planAutoAssign({
  clips,
  draftFor,
  isScheduled,
  slots,
  isTargetSlotTaken,
  skipKeys,
  shortsCap
}: BulkContext & {
  slots: ScheduleSlot[];
  isTargetSlotTaken: (target: PlatformTarget, slotUtc: string) => boolean;
  skipKeys?: ReadonlySet<string>;
  shortsCap?: ShortsCap;
}): AutoAssignPlan {
  const consumed = new Set<string>();
  // Shorts this plan has already put on each day, on top of `shortsCap.booked`.
  const planned = new Map<string, number>();
  const assignments: AutoAssignPlan["assignments"] = [];
  const heldBack: ReadyClip[] = [];
  let unslotted = 0;
  let capBlocked = 0;
  for (const clip of clips) {
    if (isScheduled(clip)) continue;
    if (skipKeys?.has(clip.key)) {
      heldBack.push(clip);
      continue;
    }
    const draft = draftFor(clip);
    const platforms: PlatformId[] = targetPlatforms(draft.platform);
    // The server counts distinct VIDEOS toward the day's cap. One clip aimed at
    // several platforms is one queue item per request (`schedulePlatforms`) but
    // still one video, so it takes exactly one of the day's places.
    const free = (candidate: ScheduleSlot) =>
      // `bookable`, not `!past`: auto-assign is exactly the button that used
      // to fill the rest of today with a whole batch of shorts.
      candidate.bookable &&
      !platforms.some((platform) => consumed.has(`${platform}:${candidate.utc}`)) &&
      !isTargetSlotTaken(draft.platform, candidate.utc);
    const roomOnDay = (candidate: ScheduleSlot) =>
      !shortsCap ||
      (shortsCap.booked.get(candidate.dateKey) ?? 0) + (planned.get(candidate.dateKey) ?? 0) + 1 <=
        shortsCap.limit;
    const slot = slots.find((candidate) => free(candidate) && roomOnDay(candidate));
    if (!slot) {
      unslotted += 1;
      if (slots.some(free)) capBlocked += 1;
      continue;
    }
    for (const platform of platforms) consumed.add(`${platform}:${slot.utc}`);
    planned.set(slot.dateKey, (planned.get(slot.dateKey) ?? 0) + 1);
    assignments.push({ clip, draft: { ...draft, slotUtc: slot.utc } });
  }
  return { assignments, unslotted, capBlocked, heldBack };
}

/**
 * What the bulk button says it will do, counted through the same plan the click
 * runs: "Schedule 7 clips: 2 a day from tomorrow". `tomorrowKey` is tomorrow's
 * date in the publish timezone; without it the first day is named by its date.
 * Null when the plan books nothing, so the caller keeps its own wording.
 */
export function bulkBookingLabel(
  plan: Pick<AutoAssignPlan, "assignments">,
  slots: ScheduleSlot[],
  tomorrowKey?: string
): string | null {
  if (plan.assignments.length === 0) return null;
  const slotByUtc = new Map(slots.map((candidate) => [candidate.utc, candidate]));
  const perDay = new Map<string, number>();
  let first: ScheduleSlot | undefined;
  for (const { draft } of plan.assignments) {
    const placed = slotByUtc.get(draft.slotUtc);
    if (!placed) continue;
    perDay.set(placed.dateKey, (perDay.get(placed.dateKey) ?? 0) + 1);
    if (!first || placed.utc < first.utc) first = placed;
  }
  const count = plan.assignments.length;
  const noun = `${count} clip${count === 1 ? "" : "s"}`;
  if (!first) return `Schedule ${noun}`;
  const from = first.dateKey === tomorrowKey ? "tomorrow" : first.dateLabel;
  if (perDay.size < 2) return `Schedule ${noun} ${first.dateKey === tomorrowKey ? "for" : "on"} ${from}`;
  return `Schedule ${noun}: ${Math.max(...perDay.values())} a day from ${from}`;
}
