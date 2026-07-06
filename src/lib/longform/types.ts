import type { SilenceRange } from "@/lib/clipping/analysis";
import type { CaptionSegment, CaptionStyle } from "@/types/domain";

// ----- Long-Form Editor -----
// A long-form project takes one long unedited recording and turns it into a
// fast-paced upload: a punched-in, captioned hook over the first seconds, the
// dead space (silence) cut out of everything after it, and optional background
// music mixed underneath. Everything below is a non-destructive instruction
// set over the uploaded source; the export bakes it into a new file.

export type LongformStatus = "processing" | "ready" | "error";

export type LongformStage = "probing" | "transcribing" | "analyzing" | "planning" | "ready";

/**
 * One span of the source timeline. Segments tile the full duration in order:
 * `speech` spans are kept by default, `silence` spans (detected dead space)
 * are cut by default. Toggling `enabled` overrides either suggestion.
 */
export type LongformSegment = {
  id: string;
  /** Seconds into the source. */
  start: number;
  end: number;
  kind: "speech" | "silence";
  /** Enabled segments play in the edited video; disabled ones are cut. */
  enabled: boolean;
};

/** The viral-style opening: punch-in zoom on the speaker plus big word-synced captions. */
export type LongformHook = {
  enabled: boolean;
  /** Hook covers [0, end] seconds of the source (typically 5-10s). */
  end: number;
  /** Punch-in zoom factor applied during the hook (1 = none). */
  zoom: number;
  /** Normalized 0..1 zoom focus point — put this on the speaker's face. */
  focusX: number;
  focusY: number;
  captionsEnabled: boolean;
  highlightCurrentWord: boolean;
  /** Hook captions in hook-local seconds (hook starts at 0, so also source seconds). */
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
};

export type LongformMusic = {
  /** References a track in the shared music library. */
  trackId?: string;
  /** 0..1 mix level under the voice track. */
  volume: number;
  /** Seconds of fade-out applied to the music at the end of the video. */
  fadeOut: number;
  enabled: boolean;
};

/** Tunables for how aggressively dead space is cut. */
export type LongformPace = {
  /** Silences at least this long (seconds) get cut. */
  minSilenceSec: number;
  /** Breathing room left on each side of a cut (seconds). */
  paddingSec: number;
};

export type LongformExportStatus = "processing" | "done" | "error";

export type LongformExportRecord = {
  id: string;
  status: LongformExportStatus;
  progress: number;
  /** File name inside the project's output dir once done. */
  file?: string;
  error?: string;
  /** Duration of the rendered edit, for the summary line. */
  durationSec?: number;
  createdAt: string;
};

export type LongformProject = {
  id: string;
  name: string;
  /** The uploaded source this project edits (shared with the clips subsystem). */
  sourceId: string;
  fileName: string;
  status: LongformStatus;
  stage: LongformStage;
  progress: number;
  error?: string;
  notices: string[];
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Full word-synced transcript of the source (source-relative seconds). */
  transcript: CaptionSegment[];
  transcriptError?: string;
  /** Raw detected silences the segment plan was built from. */
  silences: SilenceRange[];
  segments: LongformSegment[];
  hook: LongformHook;
  music: LongformMusic;
  pace: LongformPace;
  exports: LongformExportRecord[];
  createdAt: string;
  updatedAt: string;
};

/** A song uploaded to the shared background-music library. */
export type MusicTrack = {
  id: string;
  fileName: string;
  storedName: string;
  mime: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: string;
};
