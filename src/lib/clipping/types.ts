export type ClipJobStatus = "queued" | "processing" | "done" | "error";

export type ClipJobStage = "downloading" | "analyzing" | "selecting" | "rendering" | "finished";

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

export type ClipCandidate = {
  id: string;
  /** Seconds into the source video. */
  start: number;
  end: number;
  score: number;
  breakdown: ClipScoreBreakdown;
  rationale: string;
  /** Vertical 9:16 (Shorts/Reels/TikTok) output filename, set once rendered. */
  file?: string;
};

export type ClipJob = {
  id: string;
  /** Display name — the VOD title once known, otherwise the URL. */
  fileName: string;
  topic?: string;
  /** The VOD URL this job clips from. */
  sourceUrl: string;
  status: ClipJobStatus;
  stage: ClipJobStage;
  /** 0-100 across the whole pipeline. */
  progress: number;
  error?: string;
  /** Non-fatal warnings shown in the UI. */
  notices: string[];
  createdAt: string;
  durationSec?: number;
  /** Drive-synced folder the clips were copied into, when CLIPS_DRIVE_DIR is set. */
  driveFolder?: string;
  clips: ClipCandidate[];
  /**
   * Source-relative caption segments fetched on demand from the platform's
   * automatic captions. Cached so re-opening the editor is instant.
   */
  sourceCaptions?: import("@/types/domain").CaptionSegment[];
  captionsFetchedAt?: string;
  captionsError?: string;
};
