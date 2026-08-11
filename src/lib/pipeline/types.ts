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

export type PipelineRunStatus =
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
  /** The pasted VOD link, when the run started from a URL. */
  sourceUrl?: string;
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
  /**
   * Render every planned topic segment, not just the one asked for. The export
   * engine takes one render at a time, so this is a standing instruction the
   * advance loop drains rather than a batch anyone waits on.
   */
  renderAllSegments?: boolean;
  /**
   * Consecutive failures per advance step, so a step that can never succeed
   * (a source that is gone) stops reading as "working…" forever.
   */
  failures?: Record<string, number>;
  /** Why no podcast MP3 was cut — doubles as the "don't try again" marker. */
  audioNote?: string;
  /** Episode added to the Spotify RSS feed from this run's MP3. */
  podcastEpisodeId?: string;
  /** Why the episode never reached the feed — also the "don't retry" marker. */
  podcastNote?: string;
  /** Carousel written from the transcript, once available. */
  carouselId?: string;
  carouselNote?: string;
  /**
   * Whether the stage that wrote that note TRIED and failed, as opposed to
   * having nothing to work from. Recorded when it happens: deciding it later
   * from the transcript got it wrong for a run whose project had gone.
   */
  carouselGaveUp?: boolean;
  /** Text-only posts written from the transcript + clip highlights. */
  posts?: PipelinePost[];
  postsNote?: string;
  /** As `carouselGaveUp`, for the text posts. */
  postsGaveUp?: boolean;
  /** When the text posts were put on the Threads queue, so they cannot be queued twice. */
  postsQueuedAt?: string;
  /**
   * Keep booking this run's outputs as they finish. Set by "Schedule everything
   * from this run": a stream's segments render for hours after that click, and
   * without this he has to come back and press it again for each one.
   */
  queueWhenReady?: boolean;
  /**
   * Render every topic segment and schedule the Threads posts as they appear,
   * without being asked again. Set on a run the nightly scan took in: it was
   * doing the whole job while he slept and then waiting for two clicks.
   */
  unattended?: boolean;
  /**
   * Candidate ids he unticked when he confirmed the booking. The standing
   * instruction must never book these: re-planning from scratch would undo the
   * one decision the sheet asked him to make.
   */
  queueHeldBack?: string[];
  /**
   * Candidate ids already booked. Dedupe by file path alone would re-book
   * anything he later deleted from the publish queue.
   */
  queueBooked?: string[];
  /**
   * Outputs the standing instruction could not book, with why. Swallowing these
   * meant the row still said "ready to schedule" for something the app had
   * promised to book and then dropped.
   */
  queueFailures?: { title: string; error: string }[];
  createdAt: string;
  updatedAt: string;
};

/**
 * The title a failure carries when NOTHING on the run could be booked — the
 * plan itself was refused, so there is no one output to name. It lives here
 * because the recorder, the wording and the screen all have to agree on it and
 * `runs.ts` cannot import the recorder without a cycle.
 */
export const WHOLE_RUN_FAILURE = "Everything";

export type PipelineStageStatus = "waiting" | "running" | "ready" | "error" | "skipped";

export type PipelineStageKey =
  | "source"
  | "longform"
  | "segments"
  | "clips"
  | "audio"
  | "podcast"
  | "images"
  | "visuals"
  | "posts"
  | "schedule";

/** Live, joined view of one stage — what the pipeline page renders. */
export type PipelineStage = {
  status: PipelineStageStatus;
  /** One-line human summary ("8 of 10 clips rendered", "MP3 ready"). */
  detail: string;
  /** 0-100 while `running`, when the underlying job reports progress. */
  progress?: number;
  /**
   * Whether running this stage again could change anything. A stage that was
   * skipped BY DESIGN (no speech to write posts from, one continuous topic, a
   * recording with no audio track) leaves this false: offering a retry there is
   * an amber row and three model calls that land back on the same skip. A stage
   * that TRIED AND GAVE UP sets it true.
   */
  retryable?: boolean;
};

/**
 * A stage that can be started again, with the reason it needs it. Only the keys
 * in `REPAIRABLE_STAGES` (`repairable.ts`) ever appear.
 */
export type StageRepair = {
  stage: PipelineStageKey;
  status: PipelineStageStatus;
  detail: string;
};

export type PipelineRunOverview = {
  run: PipelineRun;
  stages: Record<PipelineStageKey, PipelineStage>;
  /**
   * Stages that failed or gave up and can be run again — what the page puts a
   * Retry button on and what the orchestrator is allowed to retry. Computed with
   * the overview so both read the same answer.
   */
  retryable: StageRepair[];
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
    /** How many of those segments have a finished video behind them. */
    segmentsRendered: number;
    audioReady: boolean;
    /** The MP3 is in the podcast feed — Spotify picks it up on its next read. */
    podcastPublished: boolean;
    carouselSlides: number;
    visualAdReady: boolean;
    posts: number;
    /** Publish-queue items already created from this run's clip job. */
    queued: number;
  };
  /** True when no stage is still waiting or running. */
  settled: boolean;
};

/**
 * One stream as the app shell knows it: enough to name it in the sidebar, say
 * how far along it is, and point every Formats screen at the right subject.
 * It rides the summary poll the badge already makes, so knowing which stream
 * you are working on costs no extra request.
 */
export type StreamSummary = {
  id: string;
  name: string;
  status: PipelineRunStatus;
  settled: boolean;
  needsAttention: boolean;
  /** Stages finished, out of the ones this run will ever produce. */
  ready: number;
  total: number;
  longformProjectId?: string;
  clipJobId?: string;
  carouselId?: string;
  posts: number;
  createdAt: string;
};
