import Anthropic from "@anthropic-ai/sdk";
import { TARGET_CLIP_COUNT } from "@/lib/clipping/analysis";
import { resolveThoughtEnd } from "@/lib/clipping/thought-end";
import type { CaptionSegment } from "@/types/domain";
import type { ClipCandidate, ClipScoreBreakdown } from "@/lib/clipping/types";

/**
 * Transcript-driven moment selection. Instead of guessing the best moments from
 * audio loudness (which biases toward whatever is loud, and historically toward
 * the start of the stream), this reads the FULL transcript end-to-end and asks
 * Claude to pick the strongest self-contained moments from anywhere in the VOD.
 *
 * Degrades gracefully: returns null when there is no transcript or no API key,
 * so the caller can fall back to the offline energy analysis.
 */

const MIN_CLIP_SEC = 15;
// Clips should normally land between 15 and 30 seconds. The hard cap is a bit
// higher so a genuinely continuous moment (e.g. a ~45s story that can't be cut)
// can survive, but nothing longer than this is ever produced.
const PREFERRED_MAX_CLIP_SEC = 30;
const MAX_CLIP_SEC = 45;
// A clip may run this many seconds past its proposed end so the speaker can
// finish the sentence they are in — a slightly longer clip that concludes the
// thought beats a shorter one that cuts off mid-sentence.
const END_EXTENSION_SEC = 10;
// And when no conclusion exists ahead, pull back at most this far to the
// previous completed thought instead of ending mid-sentence.
const END_TRIM_SEC = 6;
const TARGET_CLIPS = TARGET_CLIP_COUNT;
// Keep the timeline we send to the model bounded regardless of stream length so
// even a multi-hour VOD is covered end-to-end (we just coarsen the granularity).
const MAX_TIMELINE_LINES = 1500;

export function transcriptSelectionConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Renders the whole transcript as compact `[mm:ss] text` lines. Segments are
 * merged into fixed-size time buckets so the entire stream fits within a bounded
 * line budget — the model always sees the beginning, middle, and end.
 */
export function buildTimeline(segments: CaptionSegment[], durationSec: number): string {
  const span = Math.max(durationSec, segments[segments.length - 1]?.end ?? 0, 1);
  const bucketSec = Math.max(6, Math.ceil(span / MAX_TIMELINE_LINES));
  const buckets = new Map<number, { time: number; text: string[] }>();
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const key = Math.floor(seg.start / bucketSec);
    const bucket = buckets.get(key) ?? { time: key * bucketSec, text: [] };
    bucket.text.push(text);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .map((b) => `[${clock(b.time)}] ${b.text.join(" ")}`)
    .join("\n");
}

type RawClip = {
  start?: number;
  end?: number;
  title?: string;
  reason?: string;
  hook?: number;
  pacing?: number;
  standalone?: number;
  intensity?: number;
};

/** Pulls the JSON array out of the model's reply, tolerating fences / prose. */
function parseClips(text: string): RawClip[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as RawClip[]) : [];
  } catch {
    return [];
  }
}

/** Snaps a target time to the nearest caption boundary within `maxDrift` seconds. */
function snap(target: number, boundaries: number[], maxDrift: number): number {
  let best = target;
  let bestDist = maxDrift;
  for (const b of boundaries) {
    const dist = Math.abs(b - target);
    if (dist < bestDist) {
      best = b;
      bestDist = dist;
    }
  }
  return best;
}

function toCandidate(
  raw: RawClip,
  index: number,
  durationSec: number,
  segments: CaptionSegment[],
  starts: number[]
): ClipCandidate | null {
  let start = Number(raw.start);
  let end = Number(raw.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = clamp(start, 0, durationSec);
  end = clamp(end, 0, durationSec);
  if (end <= start) return null;

  // Snap the start to a caption boundary so the clip doesn't open mid-word.
  start = snap(start, starts, 3);
  // The end gets stricter treatment than "nearest caption boundary": caption
  // segments routinely break mid-sentence, so the end must land where a
  // thought actually concludes. Prefer running a few seconds longer to let
  // the speaker finish; trim back to the previous completed thought only when
  // nothing concludes ahead.
  const minEnd = Math.min(start + MIN_CLIP_SEC, durationSec);
  const resolved = resolveThoughtEnd(segments, Math.max(end, minEnd), {
    minEnd,
    maxEnd: Math.min(durationSec, start + MAX_CLIP_SEC),
    maxExtension: END_EXTENSION_SEC,
    maxTrim: END_TRIM_SEC
  });
  end = resolved.end;
  if (end - start < Math.min(MIN_CLIP_SEC, durationSec)) return null;

  const breakdown: ClipScoreBreakdown = {
    hook: Math.round(clamp(Number(raw.hook ?? 70), 0, 100)),
    pacing: Math.round(clamp(Number(raw.pacing ?? 70), 0, 100)),
    standalone: Math.round(clamp(Number(raw.standalone ?? 70), 0, 100)),
    intensity: Math.round(clamp(Number(raw.intensity ?? 70), 0, 100))
  };
  const score = Math.round(
    breakdown.hook * 0.28 + breakdown.intensity * 0.24 + breakdown.pacing * 0.33 + breakdown.standalone * 0.15
  );
  const title = raw.title?.trim();
  const reason = raw.reason?.trim() || "Selected from the transcript as a strong standalone moment.";

  return {
    id: `clip-${index + 1}`,
    start: round1(start),
    end: round1(end),
    score,
    breakdown,
    rationale: title ? `"${title}" - ${reason}` : reason
  };
}

/**
 * Reads the entire transcript and returns the best moments from across the whole
 * stream. Returns null when transcript selection is unavailable so the pipeline
 * can fall back to energy analysis.
 */
export async function selectByTranscript(
  segments: CaptionSegment[],
  durationSec: number,
  topic?: string
): Promise<ClipCandidate[] | null> {
  if (!transcriptSelectionConfigured()) return null;
  if (!segments || segments.length === 0) return null;

  const timeline = buildTimeline(segments, durationSec);
  if (!timeline.trim()) return null;

  const topicLine = topic?.trim()
    ? `The creator wants clips focused on: ${topic.trim()}. Prefer moments relevant to that, but still pick the strongest moments overall.`
    : "There is no specific topic — pick the strongest moments overall.";

  const userPrompt = `Below is the FULL timestamped transcript of a ${clock(durationSec)} stream. Each line is "[mm:ss] text" (timestamps may be h:mm:ss for long streams).

Read the ENTIRE transcript, beginning to end, and choose exactly ${TARGET_CLIPS} best moments to cut into short-form clips.

Rules:
- Choose moments from ACROSS THE WHOLE STREAM - do not cluster them all near the start. Spread them over the full timeline.
- Each clip must be a self-contained thought that makes sense without surrounding context.
- THE ENDING IS CRITICAL: before finalizing each clip, re-read the transcript around your chosen "end" time and check what the speaker is saying right there. The clip must end where the thought CONCLUDES — the end of the sentence that completes the point, story, or punchline. Never end while the speaker is mid-sentence, and never end right after they have started a NEW sentence or point that the clip won't finish. If the thought concludes a few seconds after your ideal end, extend the end to include it — a slightly longer clip that lands the conclusion is always better than one that cuts off.
- Each clip should be between ${MIN_CLIP_SEC} and ${PREFERRED_MAX_CLIP_SEC} seconds long. You may exceed ${PREFERRED_MAX_CLIP_SEC} seconds when needed to let a thought conclude, or when the moment is one continuous thought that would be ruined by cutting it shorter - but never exceed ${MAX_CLIP_SEC} seconds.
- Favour strong hooks, emotional or surprising payoffs, hot takes, stories, and quotable lines.
- Prefer variety: mix strong openings, tactical explanations, funny reactions, disagreement, turning points, and clean story payoffs when the transcript supports them.
- Avoid picking multiple moments that make the same point unless the later one has a clearly better hook or payoff.
- ${topicLine}

Return ONLY a JSON array (no prose) of objects with these fields:
- "start": clip start in seconds (number)
- "end": clip end in seconds (number)
- "title": a short punchy title for the clip (string)
- "reason": one sentence on why this moment makes a great clip (string)
- "hook": 0-100, how strong the opening line is as a scroll-stopping hook
- "pacing": 0-100, word density and how much useful speech is packed into the moment
- "standalone": 0-100, how well it stands on its own without context
- "intensity": 0-100, the strength of the emotional or informational payoff

TRANSCRIPT:
${timeline}`;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3200,
      system:
        "You are an expert short-form video editor who finds the most viral, self-contained moments inside long livestream transcripts. You always return strict JSON.",
      messages: [{ role: "user", content: userPrompt }]
    });

    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n");

    const starts = segments.map((s) => s.start);
    const candidates = parseClips(text)
      .map((raw, index) => toCandidate(raw, index, durationSec, segments, starts))
      .filter((c): c is ClipCandidate => c !== null);

    if (candidates.length === 0) return null;

    // Keep the strongest first and re-id so the UI numbering matches the order.
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, TARGET_CLIPS).map((c, i) => ({ ...c, id: `clip-${i + 1}` }));
  } catch {
    return null;
  }
}
