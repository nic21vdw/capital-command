import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES } from "@/lib/clipping/keywords";
import { resolveThoughtEnd } from "@/lib/clipping/thought-end";
import type { LongformTopic } from "@/lib/longform/types";
import type { CaptionSegment } from "@/types/domain";

// ----- Long-form topic segments -----
// A stream is not one video. Across three hours the creator moves through
// several distinct subjects — hackathon progress, a bug hunt, a business
// tangent — and each of those is its own watchable upload. This module reads
// the transcript and assembles 3-5 of them, each roughly ten minutes.
//
// A segment is GATHERED, not sliced. A stream does not run one, two, three: the
// creator drops a subject, chases something else for twenty minutes, then comes
// back to it. So a segment is a set of RANGES pulled from wherever in the
// recording that subject was actually being talked about, played back to back —
// which is what the export engine already does with the dead space it cuts, so
// nothing downstream needs a special case.
//
// This is deliberately NOT how short-form clips are chosen. The Clip Generator
// scans the whole stream for the single best 30-second moments wherever they
// fall; topic segments gather the stream into long, coherent subjects. The two
// run over the same transcript and never share a selection.
//
// The gathering runs in three passes:
//   1. Boundaries — lexical cohesion (a TextTiling-style pass): consecutive
//      blocks of speech are compared by vocabulary, and the points where
//      vocabulary turns over are where one stretch ends and the next begins.
//   2. Pieces — the recording is cut at those boundaries into a pool of
//      two-to-three minute pieces, and any piece that is mostly dead air is
//      dropped on the spot.
//   3. Subjects — the pieces are clustered by vocabulary (agglomerative,
//      strongest pair first), so pieces from opposite ends of the stream that
//      are about the same thing land in the same segment. Thin or leftover
//      clusters are left out: segments do not tile the recording.
//
// Titles follow the channel convention in clipping/titles.ts — written by
// Claude against the keyword set and style guide, with a keyword-driven
// offline fallback.

/** Seconds of speech compared as one unit when measuring vocabulary turnover. */
const BLOCK_SEC = 30;
/** Blocks of context on each side of a candidate boundary. */
const WINDOW_BLOCKS = 4;
/** A silent stretch at least this long is itself evidence of a subject change. */
const PAUSE_BOUNDARY_SEC = 20;
/** Bonus depth given to a boundary that sits on such a pause. */
const PAUSE_BOUNDARY_BONUS = 0.15;
/** How long one piece of the gathering pool runs, before clustering. */
const PIECE_TARGET_SEC = 150;
/** Shortest piece worth gathering — under this it is a scrap, not a moment. */
const MIN_PIECE_SEC = 75;
/** Words per second under which a piece is mostly dead air and gets dropped. */
const MIN_PIECE_DENSITY = 0.35;
/** Vocabulary similarity under which two pieces are not the same subject. */
const SUBJECT_FLOOR = 0.06;
/**
 * Vocabulary similarity over which two subjects are the SAME subject. A long
 * stream fills a segment to `maxSec` and leaves the rest of that subject behind
 * as another cluster; publishing both would be two uploads of one thing, so the
 * weaker one is dropped instead.
 */
const DUPLICATE_SUBJECT_CEILING = 0.5;
/** Words per second of comfortably paced speech, for scoring density. */
const FLUENT_WORDS_PER_SEC = 2.5;

export const DEFAULT_TOPIC_OPTIONS = {
  /** Shortest a topic segment may run in total — below this it is a tangent, not a video. */
  minSec: 240,
  /** Longest a topic segment may run in total before it stops gathering. */
  maxSec: 1200,
  /** The length we aim for: a ten minute upload. */
  targetSec: 600,
  minCount: 3,
  maxCount: 5
};

export type TopicPlanOptions = Partial<typeof DEFAULT_TOPIC_OPTIONS>;

/** One stretch of the recording a segment plays. */
export type PlannedRange = { start: number; end: number };

/** A topic segment found in the transcript, before it is titled. */
export type PlannedTopic = {
  /** The stretches this segment is assembled from, in chronological order. */
  ranges: PlannedRange[];
  /** First second of the first range — where the segment opens. */
  start: number;
  /** Last second of the last range; the span between the two is NOT the runtime. */
  end: number;
  /** How long the segment actually plays: the ranges added up. */
  durationSec: number;
  /** Distinctive terms of this subject, strongest first. */
  keywords: string[];
  /** Everything said inside the ranges, as plain text. */
  text: string;
  /** How strong a standalone video this subject looks like. */
  score: number;
};

// Function words carry no subject signal, so they are dropped before the
// vocabulary of two stretches is compared. Filler ("like", "gonna") is in here
// for the same reason — a rambling minute and a focused one share all of it.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "yours", "with", "that", "this", "these",
  "those", "have", "has", "had", "was", "were", "been", "being", "its", "it's", "our", "ours", "their",
  "they", "them", "there", "here", "what", "when", "where", "which", "who", "whom", "will", "would",
  "should", "could", "can", "just", "like", "really", "very", "gonna", "wanna", "kinda", "sorta",
  "yeah", "okay", "right", "know", "think", "thing", "things", "stuff", "get", "got", "getting",
  "going", "goes", "went", "make", "makes", "made", "doing", "does", "did", "done", "say", "says",
  "said", "see", "saw", "look", "looking", "want", "wants", "need", "needs", "let", "lets", "put",
  "take", "takes", "come", "comes", "back", "then", "than", "now", "some", "any", "all", "one", "two",
  "out", "into", "over", "from", "about", "because", "still", "also", "much", "many", "more", "most",
  "little", "bit", "actually", "basically", "literally", "probably", "maybe", "sure", "well", "how",
  "why", "not", "don't", "dont", "doesn't", "doesnt", "didn't", "didnt", "can't", "cant", "won't",
  "wont", "i'm", "im", "i've", "ive", "we're", "were", "that's", "thats", "it's", "you're", "youre",
  "gotta", "kind", "sort", "lot", "lots", "good", "great", "nice", "cool", "pretty", "even", "everything",
  "something", "anything", "nothing", "again", "around", "through", "before", "after", "down", "off"
]);

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/** Subject-bearing words of a line: lowercase, punctuation-free, no filler. */
export function contentTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

type Block = {
  start: number;
  end: number;
  terms: Map<string, number>;
  words: number;
};

function spokenSegments(transcript: CaptionSegment[]): CaptionSegment[] {
  return transcript
    .filter((segment) => segment.text.trim().length > 0 && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Groups the transcript into fixed-length blocks of speech. Blocks with no
 * words are dropped, so a long silence simply becomes a bigger time gap
 * between two neighbouring blocks (which the boundary scoring rewards).
 */
export function buildTopicBlocks(transcript: CaptionSegment[], blockSec = BLOCK_SEC): Block[] {
  const spoken = spokenSegments(transcript);
  const byIndex = new Map<number, Block>();
  for (const segment of spoken) {
    const index = Math.floor(segment.start / blockSec);
    const block = byIndex.get(index) ?? {
      start: segment.start,
      end: segment.end,
      terms: new Map<string, number>(),
      words: 0
    };
    block.start = Math.min(block.start, segment.start);
    block.end = Math.max(block.end, segment.end);
    for (const term of contentTerms(segment.text)) {
      block.terms.set(term, (block.terms.get(term) ?? 0) + 1);
      block.words += 1;
    }
    byIndex.set(index, block);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => block)
    .filter((block) => block.terms.size > 0);
}

function mergeTerms(blocks: Block[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const block of blocks) {
    for (const [term, count] of block.terms) merged.set(term, (merged.get(term) ?? 0) + count);
  }
  return merged;
}

/** Cosine similarity of two term bags — 1 is the same vocabulary, 0 shares none. */
export function termSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [, count] of a) magA += count * count;
  for (const [term, count] of b) {
    magB += count * count;
    const other = a.get(term);
    if (other) dot += other * count;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export type BoundaryCandidate = {
  /** Source second where the next subject starts. */
  time: number;
  /** How sharply the vocabulary turns over here. */
  depth: number;
};

/**
 * Scores every gap between blocks: how much the vocabulary on the left differs
 * from the vocabulary on the right. Depth is measured the TextTiling way —
 * against the nearest cohesion peak on each side — so only real valleys score,
 * not stretches that are uniformly loose.
 */
export function boundaryCandidates(blocks: Block[], windowBlocks = WINDOW_BLOCKS): BoundaryCandidate[] {
  if (blocks.length < 3) return [];
  const cohesion: number[] = [];
  for (let gap = 0; gap < blocks.length - 1; gap += 1) {
    const left = mergeTerms(blocks.slice(Math.max(0, gap - windowBlocks + 1), gap + 1));
    const right = mergeTerms(blocks.slice(gap + 1, Math.min(blocks.length, gap + 1 + windowBlocks)));
    cohesion.push(termSimilarity(left, right));
  }

  const candidates: BoundaryCandidate[] = [];
  for (let gap = 0; gap < cohesion.length; gap += 1) {
    const value = cohesion[gap];
    let leftPeak = value;
    for (let i = gap - 1; i >= 0 && cohesion[i] >= cohesion[i + 1]; i -= 1) leftPeak = cohesion[i];
    let rightPeak = value;
    for (let i = gap + 1; i < cohesion.length && cohesion[i] >= cohesion[i - 1]; i += 1) rightPeak = cohesion[i];
    let depth = leftPeak - value + (rightPeak - value);
    // A long silence between the two blocks is itself a subject break.
    if (blocks[gap + 1].start - blocks[gap].end >= PAUSE_BOUNDARY_SEC) depth += PAUSE_BOUNDARY_BONUS;
    if (depth <= 0) continue;
    candidates.push({ time: round3(blocks[gap + 1].start), depth: round3(depth) });
  }
  return candidates.sort((a, b) => b.depth - a.depth || a.time - b.time);
}

type Piece = { start: number; end: number };

/** Splits `piece` at the best usable boundary inside it, or returns null. */
function splitPiece(
  piece: Piece,
  candidates: BoundaryCandidate[],
  used: Set<number>,
  minSec: number,
  preferMiddle: boolean
): [Piece, Piece] | null {
  const usable = candidates.filter(
    (candidate) =>
      !used.has(candidate.time) &&
      candidate.time - piece.start >= minSec &&
      piece.end - candidate.time >= minSec
  );
  if (usable.length === 0) return null;
  // Depth order is the default; an over-long piece instead splits as close to
  // its middle as the boundaries allow so neither half stays over the cap.
  const middle = (piece.start + piece.end) / 2;
  const chosen = preferMiddle
    ? usable.reduce((best, item) =>
        Math.abs(item.time - middle) < Math.abs(best.time - middle) ? item : best
      )
    : usable[0];
  used.add(chosen.time);
  return [
    { start: piece.start, end: chosen.time },
    { start: chosen.time, end: piece.end }
  ];
}

/** Terms of a window, ranked by how much more this window uses them than the whole stream does. */
function windowKeywords(
  segments: CaptionSegment[],
  documentFrequency: Map<string, number>,
  blockCount: number,
  limit = 4
): string[] {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    for (const term of contentTerms(segment.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([term, count]) => ({
      term,
      weight: count * Math.log(1 + blockCount / Math.max(1, documentFrequency.get(term) ?? 1))
    }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map((entry) => entry.term);
}

function segmentsInWindow(spoken: CaptionSegment[], start: number, end: number): CaptionSegment[] {
  return spoken.filter((segment) => segment.start >= start - 0.001 && segment.start < end);
}

/**
 * Everything said across a segment's ranges. An ellipsis marks each jump, so
 * the titler can see it is reading one subject picked up in several places
 * rather than one continuous stretch.
 */
function rangeText(spoken: CaptionSegment[], ranges: PlannedRange[]): string {
  return ranges
    .map((range) =>
      segmentsInWindow(spoken, range.start, range.end)
        .map((segment) => segment.text.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join(" … ");
}

function wordCount(segments: CaptionSegment[]): number {
  return segments.reduce((sum, segment) => {
    const trimmed = segment.text.trim();
    return sum + (trimmed ? trimmed.split(/\s+/).length : 0);
  }, 0);
}

/**
 * Term weights of a stretch: how often it says each word, scaled by how rare
 * that word is across the whole recording. Rare words are what make two
 * stretches the same subject; "build" said everywhere says nothing.
 */
function weightedTerms(
  segments: CaptionSegment[],
  documentFrequency: Map<string, number>,
  blockCount: number
): Map<string, number> {
  const out = new Map<string, number>();
  for (const segment of segments) {
    for (const term of contentTerms(segment.text)) {
      const idf = Math.log(1 + blockCount / Math.max(1, documentFrequency.get(term) ?? 1));
      if (idf > 0) out.set(term, (out.get(term) ?? 0) + idf);
    }
  }
  return out;
}

function addWeights(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a);
  for (const [term, weight] of b) out.set(term, (out.get(term) ?? 0) + weight);
  return out;
}

/** One piece of the gathering pool: a stretch of speech and its vocabulary. */
type SubjectPiece = {
  start: number;
  end: number;
  segments: CaptionSegment[];
  terms: Map<string, number>;
  words: number;
};

type Subject = { pieces: SubjectPiece[]; terms: Map<string, number>; durationSec: number };

function pieceLength(piece: SubjectPiece): number {
  return piece.end - piece.start;
}

/**
 * Clusters the pool into subjects, strongest vocabulary match first, so pieces
 * from anywhere in the recording can end up in the same segment. Two subjects
 * only join if they genuinely share vocabulary, and a subject stops gathering
 * once it reaches `maxSec`. A long stream therefore ends with MORE subjects
 * than are wanted, and the weakest are dropped by the caller rather than
 * everything being forced into `desired` buckets.
 */
function gatherSubjects(pool: SubjectPiece[], desired: number, maxSec: number): SubjectPiece[][] {
  const subjects: Array<Subject | null> = pool.map((piece) => ({
    pieces: [piece],
    terms: piece.terms,
    durationSec: pieceLength(piece)
  }));
  const affinity = (a: Subject, b: Subject) =>
    a.durationSec + b.durationSec > maxSec ? -1 : termSimilarity(a.terms, b.terms);
  const sim = subjects.map(() => new Array<number>(subjects.length).fill(-1));
  for (let i = 0; i < subjects.length; i += 1) {
    for (let j = i + 1; j < subjects.length; j += 1) sim[i][j] = affinity(subjects[i]!, subjects[j]!);
  }

  let alive = subjects.length;
  while (alive > desired) {
    let best = -1;
    let left = -1;
    let right = -1;
    for (let i = 0; i < subjects.length; i += 1) {
      if (!subjects[i]) continue;
      for (let j = i + 1; j < subjects.length; j += 1) {
        if (!subjects[j] || sim[i][j] <= best) continue;
        best = sim[i][j];
        left = i;
        right = j;
      }
    }
    if (left === -1 || best < SUBJECT_FLOOR) break;
    subjects[left] = {
      pieces: [...subjects[left]!.pieces, ...subjects[right]!.pieces],
      terms: addWeights(subjects[left]!.terms, subjects[right]!.terms),
      durationSec: subjects[left]!.durationSec + subjects[right]!.durationSec
    };
    subjects[right] = null;
    alive -= 1;
    for (let k = 0; k < subjects.length; k += 1) {
      if (k === left || !subjects[k]) continue;
      const [lo, hi] = k < left ? [k, left] : [left, k];
      sim[lo][hi] = affinity(subjects[lo]!, subjects[hi]!);
    }
  }

  return subjects
    .filter((subject): subject is Subject => Boolean(subject))
    .map((subject) => [...subject.pieces].sort((a, b) => a.start - b.start));
}

/** How alike the pieces of one subject are — a gathered segment that hangs together scores higher. */
function subjectCohesion(pieces: SubjectPiece[]): number {
  if (pieces.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      total += termSimilarity(pieces[i].terms, pieces[j].terms);
      pairs += 1;
    }
  }
  return pairs === 0 ? 1 : total / pairs;
}

/** Adjacent pieces become one range; a gap left by dropped dead air stays a gap. */
function toRanges(pieces: SubjectPiece[]): PlannedRange[] {
  const ranges: PlannedRange[] = [];
  for (const piece of [...pieces].sort((a, b) => a.start - b.start)) {
    const last = ranges[ranges.length - 1];
    if (last && piece.start - last.end < 1) last.end = Math.max(last.end, piece.end);
    else ranges.push({ start: piece.start, end: piece.end });
  }
  return ranges;
}

/**
 * Cuts the recording into the pool of pieces the subjects are gathered from:
 * split at the sharpest vocabulary turnovers first, then keep splitting
 * anything much longer than the pool granularity so one undivided hour cannot
 * swallow a whole segment on its own.
 */
function buildPiecePool(
  span: Piece,
  candidates: BoundaryCandidate[],
  targetCount: number,
  minPieceSec: number
): Piece[] {
  const used = new Set<number>();
  let pieces: Piece[] = [span];
  const stuck = new Set<Piece>();

  while (pieces.length < targetCount) {
    const longest = pieces
      .filter((piece) => !stuck.has(piece))
      .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (!longest) break;
    const split = splitPiece(longest, candidates, used, minPieceSec, false);
    if (!split) {
      stuck.add(longest);
      continue;
    }
    pieces = pieces.flatMap((piece) => (piece === longest ? split : [piece]));
  }

  const cap = Math.max(PIECE_TARGET_SEC * 2, minPieceSec * 2);
  for (let guard = 0; guard < 400; guard += 1) {
    const overlong = pieces.find((piece) => piece.end - piece.start > cap && !stuck.has(piece));
    if (!overlong) break;
    const split = splitPiece(overlong, candidates, used, minPieceSec, true);
    if (!split) {
      stuck.add(overlong);
      continue;
    }
    pieces = pieces.flatMap((piece) => (piece === overlong ? split : [piece]));
  }

  return pieces;
}

/**
 * Reads the transcript and returns the stream's 3-5 strongest subjects, each as
 * a set of ranges gathered from wherever in the recording that subject came up.
 * Segments do not tile the recording: dead air, and stretches that never joined
 * a subject, are left out — the point is that everything that survives is a
 * video someone would sit through.
 */
export function planTopicSegments(
  transcript: CaptionSegment[],
  options: TopicPlanOptions = {}
): PlannedTopic[] {
  const { minSec, maxSec, targetSec, minCount, maxCount } = { ...DEFAULT_TOPIC_OPTIONS, ...options };
  const spoken = spokenSegments(transcript);
  if (spoken.length === 0) return [];

  const spanStart = spoken[0].start;
  const spanEnd = spoken[spoken.length - 1].end;
  const total = spanEnd - spanStart;
  if (total < minSec) return [];

  // How many segments this recording can actually carry: the target length
  // sets the ambition, the caps and the material set the limit.
  const desired = Math.max(
    1,
    Math.min(
      clamp(Math.round(total / targetSec), minCount, maxCount),
      Math.floor(total / minSec)
    )
  );

  const blocks = buildTopicBlocks(transcript);
  const candidates = boundaryCandidates(blocks);
  const minPieceSec = Math.max(BLOCK_SEC, Math.min(MIN_PIECE_SEC, minSec / 2));
  const pieceCount = Math.max(desired, Math.round(total / PIECE_TARGET_SEC));
  const pieces = buildPiecePool({ start: spanStart, end: spanEnd }, candidates, pieceCount, minPieceSec);

  const documentFrequency = new Map<string, number>();
  for (const block of blocks) {
    for (const term of block.terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  // Dead air is dropped here rather than after clustering: a piece nobody spoke
  // through has no vocabulary to gather on, and would only pad a segment.
  const pool: SubjectPiece[] = pieces
    .map((piece) => {
      const segments = segmentsInWindow(spoken, piece.start, piece.end);
      return {
        start: piece.start,
        end: piece.end,
        segments,
        words: wordCount(segments),
        terms: weightedTerms(segments, documentFrequency, blocks.length)
      };
    })
    .filter(
      (piece) => piece.terms.size > 0 && piece.words / Math.max(1, pieceLength(piece)) >= MIN_PIECE_DENSITY
    );
  if (pool.length === 0) return [];

  const describe = (group: SubjectPiece[]) => {
    const ranges = toRanges(group);
    const durationSec = group.reduce((sum, piece) => sum + pieceLength(piece), 0);
    const words = group.reduce((sum, piece) => sum + piece.words, 0);
    const text = rangeText(spoken, ranges);
    const density = clamp(words / Math.max(1, durationSec) / FLUENT_WORDS_PER_SEC, 0, 1);
    const lengthFit = clamp(1 - Math.abs(durationSec - targetSec) / targetSec, 0, 1);
    const lower = text.toLowerCase();
    const channelHits = CHANNEL_KEYWORDS.filter((keyword) => lower.includes(keyword.toLowerCase())).length;
    return {
      ranges,
      durationSec,
      terms: group.map((piece) => piece.terms).reduce(addWeights, new Map<string, number>()),
      score: round3(
        density * 2 + lengthFit * 1.5 + subjectCohesion(group) * 0.5 + clamp(channelHits / 4, 0, 1)
      )
    };
  };

  const subjects = gatherSubjects(pool, desired, maxSec).map(describe);
  const strong = subjects.filter((subject) => subject.durationSec >= minSec);
  // Nothing gathered into a full-length subject. If the recording is short
  // enough to be one upload on its own, that is what it is.
  const usable = strong.length > 0 ? strong : total <= maxSec ? [describe(pool)] : [];

  // One subject, one upload. Where the cap left the same subject in two
  // clusters, the one carrying more of it represents the subject and the rest
  // of that material is left out rather than published twice.
  const families: Array<Array<(typeof usable)[number]>> = [];
  for (const subject of [...usable].sort((a, b) => b.durationSec - a.durationSec)) {
    const family = families.find((members) =>
      members.some((member) => termSimilarity(member.terms, subject.terms) >= DUPLICATE_SUBJECT_CEILING)
    );
    if (family) family.push(subject);
    else families.push([subject]);
  }

  const kept = families
    .map((members) => members[0])
    .sort((a, b) => b.score - a.score)
    .slice(0, desired)
    .sort((a, b) => a.ranges[0].start - b.ranges[0].start);
  if (kept.length === 0) return [];

  // Land every edge on a completed thought so no range opens or closes halfway
  // through a sentence, and never past where the next range begins.
  const edges = kept
    .flatMap((subject) => subject.ranges.map((range) => range.start))
    .sort((a, b) => a - b);

  return kept
    .map((subject) => {
      const ranges = subject.ranges.map((range) => {
        const opening = spoken.find((segment) => segment.start >= range.start - 0.001);
        const start = round3(opening && opening.start < range.end ? opening.start : range.start);
        const nextEdge = edges.find((edge) => edge >= range.end - 0.001) ?? spanEnd;
        const resolved = resolveThoughtEnd(spoken, range.end, {
          minEnd: Math.min(range.end, start + minPieceSec / 2),
          maxEnd: Math.max(range.end, nextEdge),
          maxExtension: 30,
          maxTrim: 30
        });
        return { start, end: round3(Math.max(start + minPieceSec / 2, resolved.end)) };
      });
      const segments = ranges.flatMap((range) => segmentsInWindow(spoken, range.start, range.end));
      return {
        ranges,
        start: ranges[0].start,
        end: ranges[ranges.length - 1].end,
        durationSec: round3(ranges.reduce((sum, range) => sum + (range.end - range.start), 0)),
        keywords: windowKeywords(segments, documentFrequency, blocks.length),
        text: rangeText(spoken, ranges),
        score: subject.score
      };
    })
    .filter((topic) => topic.text.length > 0);
}

// ----- Titles and summaries -----

const TITLE_CASE_SKIP = new Set(["and", "or", "the", "a", "an", "of", "to", "in", "on", "for", "with", "at", "by"]);

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && TITLE_CASE_SKIP.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/**
 * Offline title for a segment: its distinctive terms as a noun phrase. Never a
 * transcript fragment (see CLAUDE.md) — this is a label built from what the
 * stretch is about, used only when Claude is unavailable.
 */
export function fallbackTopicTitle(keywords: string[], index: number): string {
  const words = keywords.slice(0, 3).filter(Boolean);
  if (words.length === 0) return `Segment ${index + 1}`;
  const phrase = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
  return titleCase(phrase);
}

export function fallbackTopicSummary(keywords: string[]): string {
  if (keywords.length === 0) return "A self-contained stretch of the stream.";
  return `The part of the stream about ${keywords.slice(0, 3).join(", ")}.`;
}

const MAX_TOPIC_EXCERPT_CHARS = 2200;
const MAX_TOPIC_TITLE_CHARS = 95;

export const TOPIC_SEGMENT_SYSTEM_PROMPT = `You are a YouTube strategist who turns one long live stream into several standalone long-form uploads.

Channel context: the creator live-streams himself building CoLateral (an AI-powered workspace for structural engineers) using AI coding tools, and shares what he learns about AI, business and engineering. Recurring keywords to work in whenever a segment genuinely supports them: ${CHANNEL_KEYWORDS.join(", ")}.

Each segment below is one subject the stream covered, and it will be published as its own video. A segment is often gathered from several moments spread across the stream, so its transcript can jump — an ellipsis marks each jump. Write about the SUBJECT the moments share, never about the stream's running order or where in the stream they came from. For every segment write:
- "title": a complete, grammatical phrase in Title Case, under ${MAX_TOPIC_TITLE_CHARS} characters. NEVER a transcript fragment and never a thought that trails off. Lead with curiosity, stakes, or a bold claim. No quotation marks, hashtags, or emoji.
- "summary": one sentence (under 160 characters) saying what this segment covers, in plain language.

Titles must be distinct from each other — they are separate uploads from the same stream, so none of them may read as a duplicate.

Examples of the exact title style to match:
${TITLE_STYLE_EXAMPLES.map((t) => `- ${t}`).join("\n")}

You always return strict JSON.`;

export type TopicTitleRequest = {
  id: string;
  /** Whole minutes the segment runs, for the model's sense of scale. */
  minutes: number;
  /** How many stretches of the recording it is gathered from; 1 is continuous. */
  parts?: number;
  /** What is said inside the segment, plain text. */
  text: string;
};

/** Builds the user prompt listing every segment. Pure, for tests. */
export function buildTopicSegmentPrompt(segments: TopicTitleRequest[], context?: { streamTitle?: string }): string {
  const lines: string[] = [];
  if (context?.streamTitle?.trim()) lines.push(`Stream: ${context.streamTitle.trim()}`);
  lines.push(
    `This stream was gathered into ${segments.length} topic segment${segments.length === 1 ? "" : "s"}. Write a title and a summary for EACH.`,
    "",
    'Return ONLY a JSON array (no prose) of objects: [{"id": "<segment id>", "title": "...", "summary": "..."}] — one entry per segment, keeping each id exactly as given.',
    ""
  );
  for (const segment of segments) {
    const parts = segment.parts && segment.parts > 1 ? `, gathered from ${segment.parts} moments` : "";
    lines.push(
      `Segment ${segment.id} (about ${segment.minutes} minute${segment.minutes === 1 ? "" : "s"} long${parts}):`,
      segment.text.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_EXCERPT_CHARS),
      ""
    );
  }
  return lines.join("\n");
}

function cleanTopicText(raw: string, maxChars: number, minWords: number): string {
  const cleaned = raw
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/#[\w-]+/g, " ")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.split(/\s+/).filter(Boolean).length < minWords) return "";
  if (cleaned.length > maxChars) return "";
  return cleaned;
}

/** Pulls the id -> {title, summary} map out of the model's reply, tolerating fences/prose. */
export function parseTopicSegments(text: string): Map<string, { title: string; summary: string }> {
  const out = new Map<string, { title: string; summary: string }>();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return out;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed) {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      const title = typeof entry?.title === "string" ? cleanTopicText(entry.title, MAX_TOPIC_TITLE_CHARS, 3) : "";
      const summary = typeof entry?.summary === "string" ? cleanTopicText(entry.summary, 220, 3) : "";
      if (id && title) out.set(id, { title, summary });
    }
  } catch {
    // Unparseable reply — callers fall back to the keyword titler.
  }
  return out;
}

export function topicTitlesConfigured() {
  return aiConfigured();
}

/**
 * Writes a title and summary for every segment in one Claude call. Returns
 * null when AI is unavailable or the reply is unusable, so callers fall back
 * to the offline titler.
 */
export async function generateTopicMetadata(
  segments: TopicTitleRequest[],
  context?: { streamTitle?: string }
): Promise<Map<string, { title: string; summary: string }> | null> {
  if (!topicTitlesConfigured()) return null;
  const withText = segments.filter((segment) => segment.text.trim());
  if (withText.length === 0) return null;
  try {
    const result = await runAi({
      maxTokens: 1500,
      system: TOPIC_SEGMENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildTopicSegmentPrompt(withText, context) }]
    });
    if (!result || result.refused) return null;
    const parsed = parseTopicSegments(result.text);
    return parsed.size > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The whole job end to end: find the topic windows in the transcript and give
 * each one a publish-ready title. Never throws — a failed AI pass degrades to
 * keyword titles, and a transcript with nothing to split returns an empty list.
 */
export async function buildTopics(input: {
  streamName: string;
  transcript: CaptionSegment[];
  options?: TopicPlanOptions;
}): Promise<LongformTopic[]> {
  const planned = planTopicSegments(input.transcript, input.options);
  if (planned.length === 0) return [];

  const requests: TopicTitleRequest[] = planned.map((topic, index) => ({
    id: `topic-${index + 1}`,
    minutes: Math.max(1, Math.round(topic.durationSec / 60)),
    parts: topic.ranges.length,
    text: topic.text
  }));
  const written = await generateTopicMetadata(requests, { streamTitle: input.streamName });

  return planned.map((topic, index) => {
    const id = `topic-${index + 1}`;
    const ai = written?.get(id);
    return {
      id,
      title: ai?.title || fallbackTopicTitle(topic.keywords, index),
      summary: ai?.summary || fallbackTopicSummary(topic.keywords),
      ranges: topic.ranges,
      start: topic.start,
      end: topic.end,
      keywords: topic.keywords,
      titleSource: ai?.title ? ("ai" as const) : ("fallback" as const)
    };
  });
}
