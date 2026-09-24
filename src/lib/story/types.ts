export type Word = { w: string; s: number; e: number; p?: number };

export type Transcript = { durationSec: number; words: Word[] };

export type FaceSample = {
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  front: number;
  sharp: number;
  luma: number;
  gesture: number;
};

export type VisualSample = {
  t: number;
  sharp: number;
  luma: number;
  contrast: number;
  motion: number;
  cut: boolean;
  face: FaceSample | null;
};

export type VisualTrack = { fps: number; width: number; height: number; samples: VisualSample[] };

export type CleanupKind = "filler" | "stutter" | "false-start" | "repeat" | "silence";

export type Removal = { start: number; end: number; kind: CleanupKind; text: string };

export type AudioScores = {
  clarity: number;
  energy: number;
  paceWpm: number;
  fillerRate: number;
};

export type VisualScores = {
  sharpness: number;
  exposure: number;
  framing: number;
  eyeContact: number;
  motion: number;
  gesture: number;
  variety: number;
  unusable: string[];
};

export type UnitScores = {
  story: number;
  clarity: number;
  emotion: number;
  visual: number;
  delivery: number;
  novelty: number;
  audio: number;
  combined: number;
};

export type Unit = {
  id: string;
  start: number;
  end: number;
  firstWord: number;
  lastWord: number;
  text: string;
  audio: AudioScores;
  visual: VisualScores;
  scores: UnitScores;
  reason: string;
  retakeGroup?: string;
  retakeOf?: string;
};

export type SectionRole = "hook" | "setup" | "development" | "payoff" | "close";

export type Moment = {
  id: string;
  unitIds: string[];
  start: number;
  end: number;
  text: string;
  score: number;
};

export type OpenLoop = { plantUnitId: string; payoffUnitId: string; question: string };

export type StorySection = {
  role: SectionRole;
  title: string;
  momentIds: string[];
  reason: string;
};

export type StoryPlan = {
  hookUnitIds: string[];
  hookReason: string;
  sections: StorySection[];
  openLoops: OpenLoop[];
  source: "ai" | "heuristic" | "override";
  targetSec: number;
  shortfall?: string;
};

export type Transition = "cut" | "jump" | "j-cut" | "l-cut";

export type EdlSegment = {
  id: string;
  unitId: string;
  section: SectionRole;
  source: string;
  in: number;
  out: number;
  timelineIn: number;
  timelineOut: number;
  zoom: number;
  zoomTo: number;
  anchorX: number;
  anchorY: number;
  transition: Transition;
  shot?: "wide" | "screen" | "face";
  audioLeadSec: number;
  enabled: boolean;
  reason: string;
  audioScore: number;
  visualScore: number;
  scores: UnitScores;
};

export type Edl = {
  version: 1;
  source: string;
  fps: number;
  width: number;
  height: number;
  segments: EdlSegment[];
  runtimeSec: number;
};

export type Chapter = { seconds: number; title: string };

export type TitleStyle = "curiosity" | "outcome" | "contrarian" | "number" | "direct";

export type TitleOption = { style: TitleStyle; title: string };

export type ThumbnailConcept = {
  emotion: string;
  frame: string;
  overlay: string;
  layout: string;
  colors: string;
};

export type StoryOverrides = {
  disabledUnitIds: string[];
  hookUnitIds?: string[];
  takeChoices: Record<string, string>;
  zoom: Record<string, number>;
};

export type StoryCopy = {
  titles: TitleOption[];
  recommended: number;
  recommendedReason: string;
  hookSentence: string;
  arc: string;
  takeaways: string[];
  hashtags: string[];
  tags: string[];
  chapterTitles: Record<string, string>;
  thumbnails: ThumbnailConcept[];
};
