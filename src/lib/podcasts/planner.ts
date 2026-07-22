import { generateClipTitle } from "@/lib/clipping/editor";
import type { ClipJob } from "@/lib/clipping/types";
import type { CaptionSegment } from "@/types/domain";

export type PlannedPodcastRange = {
  kind: "full" | "chapter";
  startSec: number;
  endSec: number;
  title: string;
  description: string;
  transcriptExcerpt: string;
};

const MIN_CHAPTER_SEC = 4 * 60;
const TARGET_CHAPTER_SEC = 9 * 60;
const MAX_CHAPTER_SEC = 15 * 60;

function captionsInRange(
  captions: CaptionSegment[],
  start: number,
  end: number,
) {
  return captions.filter(
    (segment) => segment.end > start && segment.start < end,
  );
}

function cleanTranscript(captions: CaptionSegment[]) {
  return captions
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function episodeCopy(
  captions: CaptionSegment[],
  sourceName: string,
  part?: number,
) {
  const transcript = cleanTranscript(captions);
  const fallback = part ? `${sourceName} — Part ${part}` : sourceName;
  const title = generateClipTitle(captions, fallback);
  const excerptWords = transcript.split(/\s+/).slice(0, 72).join(" ");
  return {
    title,
    description: excerptWords
      ? `${excerptWords}${transcript.split(/\s+/).length > 72 ? "…" : ""}`
      : fallback,
    transcriptExcerpt: transcript.slice(0, 1200),
  };
}

/**
 * Break a livestream transcript into listenable 4–15 minute episodes. It aims
 * for a nine-minute chapter, then waits for a real pause before cutting. The
 * hard 15-minute ceiling prevents one rambling topic from swallowing the feed.
 */
export function planChapterRanges(
  captions: CaptionSegment[],
  durationSec: number,
  sourceName: string,
) {
  if (captions.length === 0 || durationSec < MIN_CHAPTER_SEC) return [];
  const ranges: PlannedPodcastRange[] = [];
  let startIndex = 0;

  while (startIndex < captions.length) {
    const start = Math.max(0, captions[startIndex].start);
    let endIndex = startIndex;
    for (let index = startIndex; index < captions.length; index += 1) {
      endIndex = index;
      const elapsed = captions[index].end - start;
      const next = captions[index + 1];
      const pauseAfter = next
        ? Math.max(0, next.start - captions[index].end)
        : Infinity;
      if (
        elapsed >= MAX_CHAPTER_SEC ||
        (elapsed >= TARGET_CHAPTER_SEC && pauseAfter >= 1.4)
      )
        break;
    }

    // Fold a tiny tail into the current episode instead of publishing a
    // two-minute orphan chapter.
    const remaining = durationSec - captions[endIndex].end;
    if (remaining > 0 && remaining < MIN_CHAPTER_SEC)
      endIndex = captions.length - 1;
    const end = Math.min(
      durationSec,
      Math.max(start + 1, captions[endIndex].end),
    );
    const window = captions.slice(startIndex, endIndex + 1);
    const copy = episodeCopy(window, sourceName, ranges.length + 1);
    ranges.push({ kind: "chapter", startSec: start, endSec: end, ...copy });
    startIndex = endIndex + 1;
  }

  return ranges.filter(
    (range, index) =>
      range.endSec - range.startSec >= MIN_CHAPTER_SEC || index === 0,
  );
}

export function planPodcastRanges(
  job: ClipJob,
  mode: "full" | "chapters" | "full-and-chapters",
): PlannedPodcastRange[] {
  const duration = Math.max(1, job.durationSec ?? 0);
  const captions = job.sourceCaptions ?? [];
  const ranges: PlannedPodcastRange[] = [];
  if (mode !== "chapters") {
    ranges.push({
      kind: "full",
      startSec: 0,
      endSec: duration,
      ...episodeCopy(captionsInRange(captions, 0, duration), job.fileName),
    });
  }
  if (mode !== "full")
    ranges.push(...planChapterRanges(captions, duration, job.fileName));
  return ranges;
}
