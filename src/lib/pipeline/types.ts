// ----- Stream Pipeline -----
// A pipeline run takes ONE stream (a VOD link or an uploaded file) and fans it
// out into every publishable format: the long-form edit, short-form clips, a
// podcast MP3, carousel images, and text-only posts — then reports when each
// output is ready to schedule. The run itself owns no media: it stores a shared
// source id plus references into the existing subsystems (long-form projects,
// clip jobs, carousels, the publish queue) and advances the next stage whenever
// the previous one finishes.

/** A text-only post written for one platform, ready to copy or schedule. */
export type PipelinePost = {
  id: string;
  platform: "x" | "threads" | "facebook";
  text: string;
};

/**
 * What a run has been asked to produce, agreed before the stream is fetched.
 * See `src/lib/pipeline/plan.ts` for the defaults and the summary it renders.
 */
export type PipelinePlan = {
  /** How many short-form clips to cut (MIN_CLIP_COUNT…MAX_CLIP_COUNT). */
  clipCount: number;
  /** Render the whole-stream long-form edit. Off still plans the edit, it just never exports. */
  longform: boolean;
  /** Split the stream into its topic segments. */
  segments: boolean;
  /** Cut the podcast MP3 out of the long-form export. Requires `longform`. */
  audio: boolean;
  /** Slides in the carousel written from the transcript; 0 writes none. */
  carouselSlides: number;
  /** Prepare the strongest transcript moment as a realistic screenshot-ad brief. */
  visualAd: boolean;
  /** Which feeds get text-only posts; empty writes none. */
  postPlatforms: PipelinePost["platform"][];
};

export type PipelineRunStatus =
  /** Waiting for the plan to be approved — nothing has been fetched yet. */
  | "planning"
  /** The source video is still downloading from the pasted link. */
  | "ingesting"
  /** The source exists; stages are fanning out and advancing. */
  | "running"
  /** Ingest failed — nothing downstream could start. */
  | "error";

export type PipelineRun = {
  id: string;
  /** Display name — the stream title once known, otherwise what was typed. */
  name: string;
  status: PipelineRunStatus;
  /** Download percentage while `ingesting`. */
  progress?: number;
  error?: string;
  notices: string[];
  /**
   * What this run will produce. Written when the run is created, editable while
   * the run is `planning`, and read by every stage from then on. Optional only
   * because runs persisted before the plan existed have none.
   */
  plan?: PipelinePlan;
  /**
   * Set when the plan was approved and the fetch was allowed to start. An
   * unattended run (the channel scan) is created already approved.
   */
  planApprovedAt?: string;
  /**
   * Set when the transcript-derived selections were approved and rendering was
   * allowed to start. Until then the long-form export and the clip renders are
   * held, which is the whole point of the second gate.
   */
  outputsApprovedAt?: string;
  /**
   * True when this run skips both gates — nobody is watching it. The channel
   * ingest sets it; the pipeline page never does.
   */
  autoApprove?: boolean;
  /** The pasted VOD link, when the run started from a URL. */
  sourceUrl?: string;
  /** A name given with the link, kept so a download that lands after the plan gate can still honour it. */
  requestedName?: string;
  /** Shared uploaded/downloaded source both editors work from. */
  sourceId?: string;
  fileName?: string;
  durationSec?: number;
  /** Long-form project auto-created from the source. */
  longformProjectId?: string;
  /** The export auto-started once the long-form analysis is ready. */
  longformExportId?: string;
  /** Clip job auto-created from the same source. */
  clipJobId?: string;
  /** Whether the topic-segment plan has been attempted from the full transcript. */
  segmentsPlanned?: boolean;
  /** Carousel written from the transcript, once available. */
  carouselId?: string;
  carouselNote?: string;
  /** Text-only posts written from the transcript + clip highlights. */
  posts?: PipelinePost[];
  postsNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type PipelineStageStatus = "waiting" | "running" | "ready" | "error" | "skipped";

export type PipelineStageKey =
  /** Gate one: what the run is about to do, before anything is fetched. */
  | "plan"
  | "source"
  | "longform"
  | "segments"
  | "clips"
  | "audio"
  | "images"
  | "visuals"
  | "posts"
  /** Gate two: the written selections, before anything is rendered. */
  | "review"
  | "schedule";

/** Live, joined view of one stage — what the pipeline page renders. */
export type PipelineStage = {
  status: PipelineStageStatus;
  /** One-line human summary ("8 of 10 clips rendered", "MP3 ready"). */
  detail: string;
  /** 0-100 while `running`, when the underlying job reports progress. */
  progress?: number;
};

/**
 * Everything the second gate puts up for approval: the choices that were made
 * from the transcript, before a frame has been encoded. Editable through
 * `PATCH /api/pipeline/<runId>` until the run is approved.
 */
export type PipelineReview = {
  /** True once every selection this run is going to make has been written. */
  ready: boolean;
  approvedAt?: string;
  /** Topic segments the stream will be split into. */
  segments: Array<{ id: string; title: string; summary: string; start: number; end: number }>;
  /** Clip moments about to be rendered, in the order they were picked. */
  clips: Array<{ id: string; title: string; hookQuote?: string; start: number; end: number; score: number }>;
  /** Slide headings of the written carousel, so the deck can be judged at a glance. */
  carouselHeadings: string[];
  posts: PipelinePost[];
  /** What is still being written, in one line, while `ready` is false. */
  pending: string[];
};

export type PipelineRunOverview = {
  run: PipelineRun;
  stages: Record<PipelineStageKey, PipelineStage>;
  /** Present once the run has a plan — the pre-flight summary and the gate. */
  plan?: PipelinePlan;
  /** Present from the moment the first selection lands until the run finishes. */
  review?: PipelineReview;
  /** Strongest transcript-grounded moment for screenshot and AI ad creation. */
  visualMoment?: {
    headline: string;
    transcript: string;
    start: number;
    end: number;
    prompt: string;
  };
  /** Counts the schedule stage summarizes. */
  schedulable: {
    clipsReady: number;
    longformReady: boolean;
    /** Topic segments found in the stream, each publishable on its own. */
    segments: number;
    audioReady: boolean;
    carouselSlides: number;
    visualAdReady: boolean;
    posts: number;
    /** Publish-queue items already created from this run's clip job. */
    queued: number;
  };
  /** True when no stage is still waiting or running. */
  settled: boolean;
};
