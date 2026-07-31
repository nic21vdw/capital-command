export type ClipJobStatus = "queued" | "processing" | "done" | "error";

export type ClipJobStage = "downloading" | "analyzing" | "selecting" | "rendering" | "finished";

export type ClipLayoutPreset = "center" | "restream-stack" | "face-stack" | "screen-focus" | "face-focus";

export type ClipLayoutRect = { x: number; y: number; w: number; h: number };

export type ClipLayoutLayerOverride = {
  source?: ClipLayoutRect;
  dest?: ClipLayoutRect;
  fit?: "cover" | "contain";
};

export type ClipLayoutOverrides = Partial<
  Record<
    ClipLayoutPreset,
    {
      layers?: ClipLayoutLayerOverride[];
    }
  >
>;

export type ClipScoreBreakdown = {
  /** Strength of the opening line — question/number/curiosity wording blended with opening loudness (0-100). */
  hook: number;
  /** Delivery liveliness — spoken words-per-second blended with energy variation (0-100). */
  pacing: number;
  /** How self-contained the clip is — complete sentence boundaries and no dangling references, plus pause snapping (0-100). */
  standalone: number;
  /** Emotional punch — overall loudness blended with emphatic language (0-100). */
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
  /** Creator-set title. Overrides the auto-derived headline when present. */
  title?: string;
  /** First spoken words of the clip, shown to explain the hook score. */
  hookQuote?: string;
  /** Neutral full-frame 16:9 source master filename, set once rendered. */
  file?: string;
  /**
   * Ready-to-post download filename: a 9:16 vertical centered over a blurred
   * fill, with the word-synced captions burned in (no watermark by default).
   * This is what the preview offers for download; the editor still opens the
   * neutral `file` master so every layer stays adjustable.
   */
  downloadFile?: string;
  /**
   * Latest Clip Editor export for this clip. When present it supersedes
   * `downloadFile` everywhere a finished clip is shown or posted (Clip
   * Generator playback/download, Uploading Center), so the edited clip and
   * the clip that gets uploaded are always the same file.
   */
  editedFile?: string;
  /**
   * Fingerprint of the project edits (trim, layout, captions, overlays, audio,
   * export settings) `editedFile` was rendered from. Lets the Uploading Center
   * tell when a saved project has been trimmed/edited since its last render, so
   * a stale cut is never uploaded. Absent on renders made before this existed.
   */
  editedSignature?: string;
  /** ISO-8601 timestamp of the last `editedFile` render, for staleness display. */
  editedAt?: string;
  /**
   * Instant preview filename: a faststart stream-copy of the cut section,
   * published the moment the section exists so the UI can play the clip
   * while the HD master render is still running.
   */
  previewFile?: string;
  /** Poster frame filename, so players paint a frame instantly instead of black. */
  posterFile?: string;
  /**
   * ISO-8601 timestamp of the last creator re-cut of this clip's in/out points.
   * A re-cut overwrites the clip's files under their existing names, so this
   * doubles as the cache-buster every surface appends to their URLs — without
   * it the browser keeps painting the previous cut from its own cache.
   */
  recutAt?: string;
  /** Where the automatic selection put this clip, kept so a re-cut can be undone. */
  originalRange?: { start: number; end: number };
  /** Legacy layout used by older rendered files. New files are neutral source masters. */
  layoutPreset?: ClipLayoutPreset;
  /** Legacy alternate compositions rendered from the same moment. */
  variants?: Array<{
    layoutPreset: ClipLayoutPreset;
    file: string;
    label: string;
  }>;
};

export type ClipJob = {
  id: string;
  /** Display name — the VOD title once known, otherwise the URL. */
  fileName: string;
  topic?: string;
  /** The VOD URL this job clips from, or `upload://<sourceId>` for local uploads. */
  sourceUrl: string;
  /** Set when the job was created from an uploaded file instead of a URL. */
  sourceId?: string;
  /**
   * How many clips the creator asked to generate from this source. Chosen at
   * upload time (defaults to TARGET_CLIP_COUNT) and drives every selection pass.
   */
  clipCount?: number;
  renderLayout?: ClipLayoutPreset;
  renderVariants?: boolean;
  layoutOverrides?: ClipLayoutOverrides;
  status: ClipJobStatus;
  stage: ClipJobStage;
  /** 0-100 across the whole pipeline. */
  progress: number;
  error?: string;
  /** Non-fatal warnings shown in the UI. */
  notices: string[];
  createdAt: string;
  durationSec?: number;
  /**
   * Full-source audio silence ranges measured with ffmpeg. New clip projects
   * window these into clip-local keep/cut blocks; older jobs fall back to word gaps.
   */
  silences?: import("@/lib/clipping/analysis").SilenceRange[];
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
