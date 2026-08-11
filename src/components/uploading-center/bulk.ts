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

export type AutoAssignPlan = {
  assignments: Array<{ clip: ReadyClip; draft: ClipDraft }>;
  /** Clips with nowhere to go because the window ran out of free slots. */
  unslotted: number;
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
  skipKeys
}: BulkContext & {
  slots: ScheduleSlot[];
  isTargetSlotTaken: (target: PlatformTarget, slotUtc: string) => boolean;
  skipKeys?: ReadonlySet<string>;
}): AutoAssignPlan {
  const consumed = new Set<string>();
  const assignments: AutoAssignPlan["assignments"] = [];
  const heldBack: ReadyClip[] = [];
  let unslotted = 0;
  for (const clip of clips) {
    if (isScheduled(clip)) continue;
    if (skipKeys?.has(clip.key)) {
      heldBack.push(clip);
      continue;
    }
    const draft = draftFor(clip);
    const platforms: PlatformId[] = targetPlatforms(draft.platform);
    const slot = slots.find(
      (candidate) =>
        !candidate.past &&
        !platforms.some((platform) => consumed.has(`${platform}:${candidate.utc}`)) &&
        !isTargetSlotTaken(draft.platform, candidate.utc)
    );
    if (!slot) {
      unslotted += 1;
      continue;
    }
    for (const platform of platforms) consumed.add(`${platform}:${slot.utc}`);
    assignments.push({ clip, draft: { ...draft, slotUtc: slot.utc } });
  }
  return { assignments, unslotted, heldBack };
}
