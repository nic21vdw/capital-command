import { timecode, transcriptDigest, type TranscriptSegment } from "@/lib/carousels/anchors";

/** Original material carried into the rewrite, never inferred from the draft. */
export type CarouselStorySource = {
  title?: string;
  sourceText?: string;
  transcript?: TranscriptSegment[];
  imageNotes?: string;
  atSeconds?: Array<number | null | undefined>;
};

const SOURCE_LIMIT = 12000;
const MOMENT_LIMIT = 1600;
const OMISSION = "\n[...source text omitted; check the full source...]\n";

function excerpt(text: string, limit: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return { text: trimmed, truncated: false };
  if (limit <= OMISSION.length) return { text: OMISSION.slice(0, Math.max(0, limit)), truncated: true };
  const head = Math.ceil((limit - OMISSION.length) / 2);
  const tail = Math.floor((limit - OMISSION.length) / 2);
  return { text: `${trimmed.slice(0, head)}${OMISSION}${tail ? trimmed.slice(-tail) : ""}`, truncated: true };
}

function cueText(cue: TranscriptSegment): string {
  return `[${timecode(cue.start)}] ${cue.text.trim()}`;
}

function chosenMoment(transcript: TranscriptSegment[], seconds: number, index: number) {
  const nearby = transcript.filter((cue) => cue.text.trim() && cue.end >= seconds - 15 && cue.start <= seconds + 15);
  const anchors = nearby.filter((cue) => cue.start <= seconds && cue.end > seconds);
  const anchored = new Set(anchors);
  const context = nearby.filter((cue) => !anchored.has(cue));
  const header = anchors.length ? "Anchor cue(s):\n" : "No transcript cue covers the selected second. Nearby context is not anchor evidence:\n";
  const anchor = excerpt(anchors.map(cueText).join("\n"), MOMENT_LIMIT - header.length);
  let text = header + anchor.text;
  const contextHeader = anchors.length ? "\n\nNearby context:\n" : "";
  const room = MOMENT_LIMIT - text.length - contextHeader.length;
  const contextExcerpt = excerpt(context.map(cueText).join("\n"), Math.max(0, room));
  if (context.length && room > OMISSION.length) text += contextHeader + contextExcerpt.text;
  const contextTruncated = context.length > 0 && (room <= OMISSION.length || contextExcerpt.truncated);
  const sourceCheckRequired = !anchors.length || anchor.truncated || contextTruncated;
  return {
    slide: index + 1,
    atSeconds: seconds,
    text,
    anchorMatched: anchors.length > 0,
    anchorTruncated: anchor.truncated,
    contextTruncated,
    ...(sourceCheckRequired ? { sourceCheckRequired: true, uncertainty: "Missing or omitted cue text may contain a qualification. Check the full source before asserting a result." } : {})
  };
}

/**
 * A strictly bounded broad digest supplies context. Chosen moments reserve
 * their budget for the anchor cue before neighboring cues; any missing or
 * truncated context is explicit, rather than presented as complete evidence.
 * JSON fences source instructions as material, rather than reviewer commands.
 */
export function buildCarouselEvidence(source?: CarouselStorySource): string {
  if (!source) return "Original source unavailable. The draft alone is not evidence that its claims are true.";
  const transcript = source.transcript ?? [];
  const moments = (source.atSeconds ?? []).flatMap((seconds, index) => {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return [];
    return transcript.length ? [chosenMoment(transcript, seconds, index)] : [];
  });
  const digest = transcript.length ? transcriptDigest(transcript, SOURCE_LIMIT) : source.sourceText ?? "";
  const bounded = excerpt(digest, SOURCE_LIMIT);
  const text = bounded.text;
  const fullLength = Math.max(0, transcript.reduce((length, cue) => length + (cue.text.trim() ? cueText(cue).length + 1 : 0), 0) - 1);
  const sourceTruncated = bounded.truncated || fullLength > digest.length;
  if (!text && !source.imageNotes?.trim()) return "Original source unavailable. The draft alone is not evidence that its claims are true.";
  return JSON.stringify({
    title: source.title?.trim() || undefined,
    source: text,
    ...(sourceTruncated ? { sourceTruncated: true, uncertainty: "The broad source excerpt omits text. Missing context may change a claim; this is not complete source verification." } : {}),
    ...(moments.length ? { chosenMoments: moments } : {}),
    ...(source.imageNotes?.trim() ? { suppliedPhotoDescriptions: excerpt(source.imageNotes, 2000).text } : {})
  }, null, 2);
}
