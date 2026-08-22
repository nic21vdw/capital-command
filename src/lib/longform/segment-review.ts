import { reviewHook } from "@/lib/longform/hook-review";
import { MIN_LONGFORM_SEC } from "@/lib/longform/length";
import { exportRanges, projectForTopic, topicDurationSec } from "@/lib/longform/plan";
import type { LongformProject, LongformSegmentReview, LongformTopic } from "@/lib/longform/types";

// Reviews every topic segment the way the hook review reads the whole edit's
// opening — because each segment IS its own video, and its first seconds are
// the only ones a viewer of that video sees. A segment can open on a strong
// line and still ship without the treatment that makes an opening land: the
// burned-in words, the push-in, the motion. This says so, per segment, before
// hours of encoding go into one that opens flat.
//
// Pure and side-effect free: it reads a project and returns verdicts. Nothing
// here changes a plan — fixing an opening is moving the hook, which is the
// editor's job.

/** A push-in smaller than this is not a move anyone sees. */
const MIN_VISIBLE_ZOOM = 1.03;

/** Openings shorter than this cannot carry a hook at all. */
const MIN_HOOK_SEC = 3;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Reviews one topic segment as the standalone video it is exported as: the
 * same view of the project `projectForTopic` renders, so what is reviewed is
 * exactly what would be burned in.
 */
export function reviewTopicOpening(project: LongformProject, topic: LongformTopic): LongformSegmentReview {
  const view = projectForTopic(project, topic);
  const hook = view.hook;
  const hookSec = Math.max(0, hook.end - (hook.start ?? 0));
  const runtimeSec = topicDurationSec(project, topic);
  const opening = reviewHook(project.transcript ?? [], hook.start ?? 0, hook.end);

  const missing: string[] = [];
  if (!hook.enabled || hookSec < MIN_HOOK_SEC) {
    missing.push("This segment opens with no hook block at all — the first seconds are plain footage.");
  } else {
    const captions = hook.captionsEnabled ? hook.captions.filter((caption) => caption.enabled && caption.text.trim()) : [];
    if (captions.length === 0) {
      missing.push("Nothing is burned over the opening — the hook plays with no words on screen.");
    }
    if (hook.motionEnabled === false) {
      missing.push("Opening motion is switched off, so the frame sits dead still through the hook.");
    }
    if (hook.zoom < MIN_VISIBLE_ZOOM) {
      missing.push(`The push-in is ${hook.zoom.toFixed(2)}x — too small to read as movement. Anything under ${MIN_VISIBLE_ZOOM}x is a still frame.`);
    }
  }

  const tooShort = runtimeSec > 0 && runtimeSec < MIN_LONGFORM_SEC;
  if (tooShort) {
    missing.push(
      `This segment runs ${Math.floor(runtimeSec / 60)}m ${Math.round(runtimeSec % 60)}s — under the ${MIN_LONGFORM_SEC / 60} minute floor a long-form upload needs to carry mid-rolls.`
    );
  }

  const { hookRange } = exportRanges(view.segments, hook);
  if (hook.enabled && hookSec >= MIN_HOOK_SEC && !hookRange) {
    missing.push("The hook window is entirely inside cut footage, so the export starts on the body.");
  }

  const verdict: LongformSegmentReview["verdict"] =
    missing.length > 0 ? "weak" : opening.verdict === "unknown" ? "unknown" : opening.verdict;

  return {
    topicId: topic.id,
    title: topic.title,
    start: round1(hook.start ?? 0),
    end: round1(hook.end),
    runtimeSec: round1(runtimeSec),
    score: opening.score,
    verdict,
    opening: opening.opening,
    reasons: [...missing, ...opening.reasons],
    missingTreatment: missing,
    coldOpen: opening.coldOpen
  };
}

/** Every segment's opening, in the order they are listed. */
export function reviewTopicOpenings(project: LongformProject): LongformSegmentReview[] {
  return (project.topics ?? []).map((topic) => reviewTopicOpening(project, topic));
}

/** The segments a person still has to fix, strongest problem first. */
export function weakSegmentOpenings(reviews: LongformSegmentReview[]): LongformSegmentReview[] {
  return reviews
    .filter((review) => review.verdict === "weak")
    .sort((a, b) => b.missingTreatment.length - a.missingTreatment.length || a.score - b.score);
}

/** One line for the segment list: what the review found, or that it passed. */
export function segmentReviewHeadline(review: LongformSegmentReview): string {
  if (review.missingTreatment.length > 0) return review.missingTreatment[0];
  if (review.verdict === "unknown") return "No transcript covers this opening — watch it back yourself.";
  if (review.verdict === "weak") return `Weak opening (${review.score}/100) — it opens on a line that promises nothing.`;
  return `Opens strong (${review.score}/100) with the hook treatment on.`;
}
