/**
 * What a run is going to do, decided BEFORE the stream is downloaded.
 *
 * The pipeline's two gates both read this module. The first gate shows the plan
 * as a summary the moment a link is pasted — every format the run will produce,
 * with the knobs that change the counts — and nothing is fetched until it is
 * approved. The second gate holds the run once the transcript-derived choices
 * exist (topic segments, clip moments, slides, posts) and before anything is
 * rendered, so the selections can be edited while a change is still cheap.
 *
 * Kept dependency-free of server code: the page renders the same summary the
 * server will act on.
 */

import { MAX_SLIDES, MIN_SLIDES, DEFAULT_SLIDE_COUNT } from "@/lib/carousels/deck";
import { MAX_CLIP_COUNT, MIN_CLIP_COUNT, TARGET_CLIP_COUNT, clampClipCount } from "@/lib/clipping/clip-count";
import type { PipelinePlan, PipelinePost } from "@/lib/pipeline/types";

export { MAX_CLIP_COUNT, MIN_CLIP_COUNT, MAX_SLIDES, MIN_SLIDES };

/**
 * How many subjects the topic planner splits a stream into. The count comes
 * from the length of the recording (`topicCountCeiling`), which is not known
 * until the source has been read — so the plan promises the behaviour, not a
 * number.
 */
export const PLAN_SEGMENT_RANGE = { min: 3, max: 20 } as const;

export const PLAN_POST_PLATFORMS: Array<{ platform: PipelinePost["platform"]; label: string; count: number }> = [
  { platform: "x", label: "X", count: 3 },
  { platform: "threads", label: "Threads", count: 2 },
  { platform: "facebook", label: "FB / LinkedIn", count: 1 }
];

export function defaultPipelinePlan(): PipelinePlan {
  return {
    clipCount: TARGET_CLIP_COUNT,
    longform: true,
    segments: true,
    audio: true,
    carouselSlides: DEFAULT_SLIDE_COUNT,
    visualAd: true,
    postPlatforms: PLAN_POST_PLATFORMS.map((entry) => entry.platform)
  };
}

function clampSlideCount(value: unknown): number {
  const asked = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_SLIDE_COUNT;
  // Zero is meaningful — it is how the plan turns the carousel off — so it is
  // not clamped up into the deck's minimum.
  if (asked <= 0) return 0;
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, asked));
}

function readPlatforms(value: unknown, fallback: PipelinePost["platform"][]): PipelinePost["platform"][] {
  if (!Array.isArray(value)) return fallback;
  const allowed = PLAN_POST_PLATFORMS.map((entry) => entry.platform);
  const picked = allowed.filter((platform) => value.includes(platform));
  return picked;
}

/**
 * Coerces anything that arrived over the wire (or was persisted by an older
 * build) into a usable plan. Missing fields fall back to `base`, so a PATCH can
 * send only what changed.
 */
export function normalizePipelinePlan(value: unknown, base: PipelinePlan = defaultPipelinePlan()): PipelinePlan {
  const input = (value ?? {}) as Partial<Record<keyof PipelinePlan, unknown>>;
  const bool = (key: keyof PipelinePlan, current: boolean) =>
    typeof input[key] === "boolean" ? (input[key] as boolean) : current;

  const longform = bool("longform", base.longform);
  return {
    clipCount: clampClipCount(typeof input.clipCount === "number" ? input.clipCount : base.clipCount),
    longform,
    segments: bool("segments", base.segments),
    // The MP3 is cut out of the finished long-form export, so it cannot be
    // asked for on its own — turning the edit off turns the audio off with it.
    audio: longform && bool("audio", base.audio),
    carouselSlides: clampSlideCount("carouselSlides" in input ? input.carouselSlides : base.carouselSlides),
    visualAd: bool("visualAd", base.visualAd),
    postPlatforms: readPlatforms(input.postPlatforms, base.postPlatforms)
  };
}

export function plannedPostCount(plan: PipelinePlan): number {
  return PLAN_POST_PLATFORMS.filter((entry) => plan.postPlatforms.includes(entry.platform)).reduce(
    (total, entry) => total + entry.count,
    0
  );
}

export type PlannedOutput = {
  key: "longform" | "segments" | "clips" | "audio" | "images" | "visuals" | "posts";
  label: string;
  /** What the run will produce for this format, in one line. */
  detail: string;
  enabled: boolean;
};

/**
 * The pre-flight summary: one line per format, in the order the flow shows
 * them. This is what the first gate renders, so it has to read as a promise
 * about the run rather than a description of the feature.
 */
export function plannedOutputs(plan: PipelinePlan): PlannedOutput[] {
  const posts = plannedPostCount(plan);
  const platformLabels = PLAN_POST_PLATFORMS.filter((entry) => plan.postPlatforms.includes(entry.platform))
    .map((entry) => entry.label)
    .join(", ");
  return [
    {
      key: "longform",
      label: "Long-form edit",
      detail: plan.longform
        ? "One edited video — dead space cut, hook moved to the front, captions burned in"
        : "Planned but not rendered — export it yourself from the Long-Form Editor",
      enabled: plan.longform
    },
    {
      key: "segments",
      label: "Topic segments",
      detail: plan.segments
        ? "The stream split into the subjects it covers — more of them the longer it runs — each publishable on its own (rendered on demand)"
        : "Not split into subjects",
      enabled: plan.segments
    },
    {
      key: "clips",
      label: "Short-form clips",
      detail: `${plan.clipCount} vertical clip${plan.clipCount === 1 ? "" : "s"} with titles and burned-in captions`,
      enabled: true
    },
    {
      key: "audio",
      label: "Podcast MP3",
      detail: plan.audio ? "Audio cut from the finished edit, same cuts and mix" : "No MP3",
      enabled: plan.audio
    },
    {
      key: "images",
      label: "Carousel images",
      detail: plan.carouselSlides > 0 ? `One ${plan.carouselSlides}-slide carousel written from the transcript` : "No carousel",
      enabled: plan.carouselSlides > 0
    },
    {
      key: "visuals",
      label: "Realistic visual ads",
      detail: plan.visualAd ? "The strongest transcript moment prepared as a screenshot-ad brief" : "No visual ad brief",
      enabled: plan.visualAd
    },
    {
      key: "posts",
      label: "Text-only posts",
      detail: posts > 0 ? `${posts} posts for ${platformLabels}` : "No text posts",
      enabled: posts > 0
    }
  ];
}

/** One-line version of the plan, for a log line or a collapsed card. */
export function describePlan(plan: PipelinePlan): string {
  return plannedOutputs(plan)
    .filter((output) => output.enabled)
    .map((output) => output.label.toLowerCase())
    .join(" · ");
}
