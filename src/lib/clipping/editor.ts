import { CAPTION_PRESETS } from "@/lib/clipping/captions";
import {
  defaultCaptionStyle,
  defaultClipAudio,
  defaultClipExportSettings
} from "@/lib/storage/schemas";
import type {
  AspectRatioId,
  CaptionSegment,
  CaptionPresetId,
  CaptionStyle,
  ClipProject,
  ExportPresetId
} from "@/types/domain";

/** Output pixel dimensions for each aspect ratio. */
export const ASPECT_DIMENSIONS: Record<Exclude<AspectRatioId, "custom">, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 }
};

export const ASPECT_LABELS: Record<AspectRatioId, string> = {
  "9:16": "9:16 Vertical",
  "16:9": "16:9 Landscape",
  "1:1": "1:1 Square",
  "4:5": "4:5 Portrait",
  custom: "Custom"
};

export const EXPORT_PRESETS: Record<ExportPresetId, { label: string; w: number; h: number; aspect: AspectRatioId }> = {
  shorts: { label: "YouTube Shorts", w: 1080, h: 1920, aspect: "9:16" },
  longform: { label: "YouTube Long-form", w: 1920, h: 1080, aspect: "16:9" },
  square: { label: "Square Social", w: 1080, h: 1080, aspect: "1:1" },
  portrait: { label: "Portrait Social", w: 1080, h: 1350, aspect: "4:5" },
  custom: { label: "Custom", w: 1080, h: 1920, aspect: "custom" }
};

export function aspectDimensions(aspect: AspectRatioId): { w: number; h: number } {
  return aspect === "custom" ? { w: 1080, h: 1920 } : ASPECT_DIMENSIONS[aspect];
}

export function applyCaptionPreset(style: CaptionStyle, preset: CaptionPresetId): CaptionStyle {
  return { ...style, ...CAPTION_PRESETS[preset].style };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const TITLE_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "being",
  "could",
  "from",
  "have",
  "here",
  "just",
  "like",
  "really",
  "right",
  "that",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
  "you're"
]);

function titleCaseWord(word: string): string {
  if (word.length <= 2 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function generateClipTitle(captions: CaptionSegment[], fallback = "Untitled clip"): string {
  const text = captions
    .map((caption) => caption.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;

  const sentence = text.split(/(?<=[.!?])\s+/).find((part) => part.trim().split(/\s+/).length >= 3) ?? text;
  const words = sentence
    .replace(/[^\w\s'-]/g, "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word && !TITLE_STOPWORDS.has(word.toLowerCase()))
    .slice(0, 7);
  const raw = words.length >= 3 ? words.join(" ") : sentence.split(/\s+/).slice(0, 7).join(" ");
  return raw
    .split(/\s+/)
    .map(titleCaseWord)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Builds a fresh clip project from a rendered 16:9 source master. Projects
 * open Shorts/Reels-ready: 9:16 vertical, blur-filled framing, and word-synced
 * captions on — the goal is export-and-upload with zero extra setup.
 */
export function makeClipProject(input: {
  jobId: string;
  name: string;
  sourceFile: string;
  posterFile?: string;
  sourceUrl: string;
  clipStart: number;
  clipEnd: number;
}): ClipProject {
  const now = new Date().toISOString();
  const duration = Math.max(0.1, input.clipEnd - input.clipStart);
  return {
    id: `clip-${crypto.randomUUID()}`,
    name: input.name,
    jobId: input.jobId,
    sourceFile: input.sourceFile,
    posterFile: input.posterFile,
    sourceUrl: input.sourceUrl,
    baseDurationSec: duration,
    baseWidth: 1920,
    baseHeight: 1080,
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    trimStart: 0,
    trimEnd: duration,
    title: "",
    aspectRatio: "9:16",
    compositionMode: "center-blur",
    reframe: { scale: 1, offsetX: 0, offsetY: 0 },
    captions: [],
    captionStyle: { ...defaultCaptionStyle },
    captionsVisible: true,
    highlightCurrentWord: true,
    overlays: [],
    audio: { ...defaultClipAudio },
    exportSettings: { ...defaultClipExportSettings },
    suggestions: [],
    createdAt: now,
    updatedAt: now
  };
}
