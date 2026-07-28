import type { CaptionSegment } from "@/types/domain";
import type { ClipCandidate } from "@/lib/clipping/types";

export type VisualMoment = {
  headline: string;
  transcript: string;
  start: number;
  end: number;
};

export type VisualAdFormat = "portrait" | "story" | "square" | "landscape";

const FORMAT_SIZES: Record<VisualAdFormat, { width: number; height: number; label: string }> = {
  portrait: { width: 1080, height: 1350, label: "4:5 feed" },
  story: { width: 1080, height: 1920, label: "9:16 story" },
  square: { width: 1080, height: 1080, label: "1:1 square" },
  landscape: { width: 1920, height: 1080, label: "16:9 landscape" }
};

function clean(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function fallbackHeadline(transcript: string) {
  const words = transcript.replace(/[.!?].*$/, "").split(/\s+/).filter(Boolean).slice(0, 8);
  const line = words.join(" ").replace(/^[,.:;\-]+|[,.:;\-]+$/g, "");
  return line || "The Moment Everything Clicked";
}

export function visualMomentFromClips(
  clips: ClipCandidate[],
  captions: CaptionSegment[] = []
): VisualMoment | null {
  const ranked = [...clips]
    .filter((clip) => clip.end > clip.start)
    .sort((a, b) => b.score - a.score);
  const clip = ranked[0];
  if (!clip) return null;

  const transcript = clean(
    captions
      .filter((segment) => segment.end >= clip.start && segment.start <= clip.end)
      .map((segment) => segment.text)
      .join(" ")
  );
  const hook = clean(clip.hookQuote);

  return {
    headline: clean(clip.title) || fallbackHeadline(transcript || hook),
    transcript: transcript || hook,
    start: clip.start,
    end: clip.end
  };
}

export function realisticImagePrompt(moment: VisualMoment, streamName: string) {
  const context = moment.transcript
    ? `The selected livestream moment says: "${moment.transcript.slice(0, 700)}"`
    : `The selected livestream is titled "${clean(streamName)}".`;

  return [
    "Use the attached livestream screenshot as a high-fidelity visual reference.",
    context,
    `Advertising hook: "${moment.headline}".`,
    "Create a photorealistic premium social ad that preserves the real creator, workstation, room, clothing, camera angle, and on-screen subject.",
    "Improve only the commercial photography qualities: balanced exposure, natural skin texture, believable monitor light, clean composition, and restrained depth of field.",
    "Leave intentional negative space for the hook. Do not render the hook or any other text inside the generated image.",
    "No invented logos, products, people, UI copy, or claims.",
    "Avoid cartoons, illustrations, anime, 3D renders, CGI, plastic skin, fantasy interfaces, holograms, exaggerated neon, malformed hands, and illegible text."
  ].join("\n");
}

export function adCanvasSize(format: VisualAdFormat) {
  return FORMAT_SIZES[format];
}

export function fitCover(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height
  };
}
