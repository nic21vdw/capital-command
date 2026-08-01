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
  /** Why no podcast MP3 was cut — doubles as the "don't try again" marker. */
  audioNote?: string;
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
  | "source"
  | "longform"
  | "segments"
  | "clips"
  | "audio"
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
};

export type PipelineRunOverview = {
  run: PipelineRun;
  stages: Record<PipelineStageKey, PipelineStage>;
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
