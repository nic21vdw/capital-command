import type { SilenceRange } from "@/lib/clipping/analysis";
import type { CaptionSegment, CaptionStyle, SfxSettings } from "@/types/domain";

// ----- Long-Form Editor -----
// A long-form project takes one long unedited recording and turns it into a
// fast-paced upload: a punched-in, captioned hook over the first seconds, the
// dead space (silence) cut out of everything after it, and optional background
// music mixed underneath. Everything below is a non-destructive instruction
// set over the uploaded source; the export bakes it into a new file.

export type LongformStatus = "processing" | "ready" | "error";

/**
 * Output frame of the export (and the preview that mirrors it).
 * - `wide`: the classic 16:9 1920x1080 long-form frame.
 * - `vertical`: a 9:16 1080x1920 short-form frame — the edit is centered at
 *   full width over a blurred, dimmed fill of itself (nothing cropped away),
 *   the same composition the Clip Generator's vertical renders use.
 */
export type LongformLayout = "wide" | "vertical";

export type LongformStage = "downloading" | "probing" | "transcribing" | "analyzing" | "planning" | "ready";

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
  /**
   * First source second the hook is pulled from. Usually 0 (the recording's
   * opening), but can be moved later so a fumbled start isn't forced to be the
   * hook. The hook window [start, end] is always played to the front of the
   * export; everything else kept plays after it as the body.
   */
  start: number;
  /** Last source second of the hook window. Hook covers [start, end] (typically 5-10s long). */
  end: number;
  /** Punch-in zoom factor applied during the hook (1 = none). */
  zoom: number;
  /** Normalized 0..1 zoom focus point — put this on the speaker's face. */
  focusX: number;
  focusY: number;
  captionsEnabled: boolean;
  highlightCurrentWord: boolean;
  /** Hook captions in hook-local seconds (relative to `start`, i.e. the hook plays from 0). */
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
};

/**
 * Whole-video captions — the same functionality the short-form Clip Editor
 * has, applied to the entire long-form video. Segments live in source-timeline
 * seconds (the same coordinate the segments and hook use), so the preview can
 * show them directly; the export maps them onto the edited runtime. When the
 * hook burns its own captions, these take over from `hook.end` onward.
 */
export type LongformCaptions = {
  enabled: boolean;
  highlightCurrentWord: boolean;
  /** Caption segments in source-timeline seconds, chunked from the transcript. */
  segments: CaptionSegment[];
  style: CaptionStyle;
};

/**
 * An image dropped onto the timeline and shown as an overlay. Timing is in
 * source-timeline seconds (the same coordinate the segments and hook use), so
 * the preview can show it directly; the export maps it onto the edited runtime.
 */
export type LongformOverlay = {
  id: string;
  fileName: string;
  /** File on disk inside the project's image dir. */
  storedName: string;
  mime: string;
  /** Visible over [start, end] seconds of the source timeline. */
  start: number;
  end: number;
  /** Normalized center position within the frame (0..1). */
  x: number;
  y: number;
  /** Width as a fraction of the frame width (0..1); height keeps the aspect. */
  width: number;
  /** 0..1 opacity of the overlay. */
  opacity: number;
};

/**
 * One audio clip placed on the timeline's audio track. Like an image overlay,
 * its timing lives in source-timeline seconds; the export maps that onto the
 * edited runtime. The referenced library track loops to fill `duration`, so a
 * short sound can be stretched to run under a whole section.
 */
export type LongformAudioClip = {
  id: string;
  /** References a track in the shared music library. */
  trackId: string;
  /** Display name copied from the library track. */
  fileName: string;
  /** Seconds into the source timeline where the clip starts playing. */
  start: number;
  /** How many seconds of audio play; the track loops to fill this length. */
  duration: number;
  /** 0..1 mix level under the voice track — the single audio volume control. */
  volume: number;
};

export type LongformMusic = {
  /** Master switch: mix the placed audio clips into the export. */
  enabled: boolean;
  /** Audio clips placed on the timeline audio track. */
  clips: LongformAudioClip[];
  /** Gain applied to the original video's own audio (1 = unchanged). */
  videoVolume: number;
  /** Master gain applied to the whole mixed audio (1 = unchanged). */
  masterVolume: number;
  /** @deprecated Legacy single background track; migrated to a clip on load. */
  trackId?: string;
  /** @deprecated Legacy background volume; migrated onto the clip. */
  volume?: number;
  /** @deprecated Legacy background fade-out. */
  fadeOut?: number;
};

/**
 * One subject the recording covers, found by reading the transcript — the
 * long-form counterpart to a short-form clip. A stream that ran three hours
 * carries several of these (hackathon progress, a bug hunt, a business
 * tangent), and each one exports as its own standalone upload of roughly ten
 * minutes, cut and captioned with the project's own settings.
 *
 * Topics do NOT tile the recording: stretches that are mostly dead air or
 * off-topic chatter are left out on purpose. They are also entirely separate
 * from short-form clip selection, which scans the whole stream for its own
 * best 30-second moments.
 */
export type LongformTopic = {
  id: string;
  /** Publish-ready title for this segment as its own video. */
  title: string;
  /** One line on what the segment covers. */
  summary: string;
  /** Source-timeline seconds, both landing on a completed thought. */
  start: number;
  end: number;
  /** Distinctive terms that made this stretch its own subject. */
  keywords: string[];
  /** Whether Claude wrote the title or the offline keyword titler did. */
  titleSource: "ai" | "fallback";
  /** Export record this segment was last rendered as, if any. */
  exportId?: string;
};

/** Tunables for how aggressively dead space is cut. */
export type LongformPace = {
  /** Silences at least this long (seconds) get cut. */
  minSilenceSec: number;
  /** Breathing room left on each side of a cut (seconds). */
  paddingSec: number;
};

export type LongformExportStatus = "processing" | "done" | "error" | "canceled";

export type LongformExportRecord = {
  id: string;
  status: LongformExportStatus;
  progress: number;
  /** File name inside the project's output dir once done. */
  file?: string;
  /** Audio-only (mp3) companion extracted from `file`, for podcast platforms. */
  audioFile?: string;
  error?: string;
  /** Duration of the rendered edit, for the summary line. */
  durationSec?: number;
  /** Publish-ready title after the shared emoji-decoration step. */
  title?: string;
  /** Whether the decorated title carries an injected emoji. */
  emojiUsed?: boolean;
  /** Set when this export is one topic segment rather than the whole edit. */
  topicId?: string;
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
  /**
   * Topic segments found in the transcript, each exportable as its own video.
   * Absent until they have been planned; an empty array means the planner ran
   * and found nothing to split (see `topicsNote`).
   */
  topics?: LongformTopic[];
  /** Why there are no topic segments, when the planner could not produce any. */
  topicsNote?: string;
  hook: LongformHook;
  /** Whole-video captions burned over the edited runtime. */
  captions: LongformCaptions;
  /** Images dropped onto the timeline, rendered over the edited video. */
  overlays: LongformOverlay[];
  music: LongformMusic;
  /** Auto-placed viral sound effects; absent on projects saved before the feature. */
  sfx?: SfxSettings;
  /** Output frame of the export; absent on older projects (treated as `wide`). */
  layout?: LongformLayout;
  pace: LongformPace;
  exports: LongformExportRecord[];
  /** Publish-ready titles/description/tags; absent until first generated. */
  metadata?: import("@/lib/longform/metadata").LongformVideoMetadata;
  /** Editable posting description shown in the editor's Description dropdown; absent on projects saved before the field. */
  description?: string;
  /** Comma-separated keywords/tags for this video; absent on older projects. */
  keywords?: string;
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
