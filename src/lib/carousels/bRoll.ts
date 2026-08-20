import { spreadTargets } from "@/lib/carousels/anchors";
import { extractVideoFrames, type ExtractedFrames } from "@/lib/carousels/videoFrames";
import { footageKind } from "@/lib/carousels/footage";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { listProjects } from "@/lib/longform/store";

/**
 * Where a deck's pictures come from when the recording it was written from is
 * the wrong thing to look at.
 *
 * The car videos are the case this exists for. They are shot on a phone, held
 * up, and every second of them is the same face in the same seat — so a deck
 * illustrated from one is eight near-identical portraits, several of them
 * caught mid-blink, none of them showing the thing being talked about. The
 * words are about building software; the pictures should be too. So a deck
 * written from a talking-head recording is illustrated from the most recent
 * DESK recording instead — the stream, where the building actually happens.
 *
 * The copy is untouched by this: it is still written from the words that were
 * said. Only the pictures move.
 */

/**
 * Whether a recording is worth borrowing from: long enough that spreading a
 * deck's worth of stills across it lands on genuinely different moments.
 */
const MIN_BROLL_SECONDS = 240;

/**
 * How wide the borrowed recording has to be. A still is stored at 1440 and set
 * behind copy on a 1080-wide slide, so a 640-wide VOD — and the library has
 * them — arrives upscaled to mush. Better a plain slide than a blurred one.
 */
const MIN_BROLL_WIDTH = 1280;

/** How far back to look for one before giving up rather than paying to classify a whole library. */
const MAX_CANDIDATES_EXAMINED = 8;

export type BRollSource = { sourceId: string; name: string; durationSec: number };

/**
 * The recording to borrow pictures from: the newest wide one that is not the
 * deck's own source and is still on disk. Newest, because the point is that the
 * pictures show what he is building NOW — a six-week-old stream shows a version
 * of the app that no longer exists.
 */
export async function latestDeskRecording(excludeSourceId: string): Promise<BRollSource | null> {
  const projects = await listProjects().catch(() => []);
  const candidates = projects
    .filter((project) => project.sourceId && project.sourceId !== excludeSourceId)
    .filter((project) => project.durationSec >= MIN_BROLL_SECONDS)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Walked newest-first and stopped at the first hit, rather than classified in
  // bulk: each miss is a paid look at three frames, and the newest stream is
  // almost always the answer.
  for (const project of candidates.slice(0, MAX_CANDIDATES_EXAMINED)) {
    const meta = await readSourceMeta(project.sourceId).catch(() => null);
    if (!meta || meta.width < MIN_BROLL_WIDTH) continue;
    if ((await footageKind(project.sourceId)) !== "desk") continue;
    return { sourceId: project.sourceId, name: project.name, durationSec: meta.durationSec };
  }
  return null;
}

/**
 * Stills of the work, spread across a desk recording, for a deck whose own
 * footage is a face.
 *
 * No slide words are passed to the frame picker on purpose. The relevance gate
 * asks "is the thing this slide names on this screen", and here it is not meant
 * to be — the still is establishing footage of the build, not the illustration
 * of that one sentence. Asking would reject every frame and leave the deck bare.
 */
export async function deskFramesForDeck(input: {
  excludeSourceId: string;
  slideCount: number;
}): Promise<ExtractedFrames & { borrowedFrom: BRollSource | null }> {
  const source = await latestDeskRecording(input.excludeSourceId);
  if (!source) {
    return {
      images: [],
      borrowedFrom: null,
      note: "This is a talking-head recording and there is no stream footage to illustrate it with — the slides have no pictures."
    };
  }
  const meta = await readSourceMeta(source.sourceId);
  if (!meta) return { images: [], borrowedFrom: null, note: "The stream footage this deck borrows from is no longer on disk." };

  const frames = await extractVideoFrames({
    videoPath: sourceFilePath(meta),
    durationSec: meta.durationSec,
    targets: spreadTargets(meta.durationSec, input.slideCount)
  });
  return {
    ...frames,
    borrowedFrom: source,
    note: frames.note ?? `Illustrated with stills from "${source.name}" — the recording itself is a talking-head video.`
  };
}
