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

export type AutoAssignPlan = {
  assignments: Array<{ clip: ReadyClip; draft: ClipDraft }>;
  /** Clips with nowhere to go because the window ran out of free slots. */
  unslotted: number;
};

/**
 * Pairs every unscheduled clip with the next slot that is open on all of its
 * target platforms. Slots taken inside this batch are tracked as they are
 * handed out, so two clips can never land on the same time.
 */
export function planAutoAssign({
  clips,
  draftFor,
  isScheduled,
  slots,
  isTargetSlotTaken
}: BulkContext & {
  slots: ScheduleSlot[];
  isTargetSlotTaken: (target: PlatformTarget, slotUtc: string) => boolean;
}): AutoAssignPlan {
  const consumed = new Set<string>();
  const assignments: AutoAssignPlan["assignments"] = [];
  let unslotted = 0;
  for (const clip of clips) {
    if (isScheduled(clip)) continue;
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
  return { assignments, unslotted };
}
