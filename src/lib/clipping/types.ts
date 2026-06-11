export type ClipJobStatus = "queued" | "processing" | "done" | "error";

export type ClipJobStage =
  | "uploading"
  | "probing"
  | "analyzing-audio"
  | "transcribing"
  | "selecting-clips"
  | "rendering-clips"
  | "writing-captions"
  | "generating-metadata"
  | "finished";

export type ClipScoreBreakdown = {
  /** Loudness of the opening seconds vs the whole stream (0-100). */
  hook: number;
  /** Energy variance inside the clip — proxy for pacing (0-100). */
  pacing: number;
  /** How cleanly the clip starts/ends on natural pauses (0-100). */
  standalone: number;
  /** Overall loudness percentile of the clip (0-100). */
  intensity: number;
};

export type ClipMetadata = {
  title: string;
  hook: string;
  description: string;
  caption: string;
  hashtags: string[];
};

export type ClipCandidate = {
  id: string;
  /** Seconds into the source video. */
  start: number;
  end: number;
  score: number;
  breakdown: ClipScoreBreakdown;
  rationale: string;
  /** Output filename inside the job's output directory, set once rendered. */
  file?: string;
  /** SRT caption filename, set when a transcript was available. */
  srtFile?: string;
  /** Short transcript excerpt for this range, when available. */
  transcriptExcerpt?: string;
  metadata?: ClipMetadata;
};

export type ClipJob = {
  id: string;
  fileName: string;
  topic?: string;
  status: ClipJobStatus;
  stage: ClipJobStage;
  /** 0-100 across the whole pipeline. */
  progress: number;
  error?: string;
  /** Non-fatal warnings shown in the UI (e.g. missing API keys). */
  notices: string[];
  createdAt: string;
  durationSec?: number;
  transcriptAvailable: boolean;
  metadataAvailable: boolean;
  clips: ClipCandidate[];
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};
