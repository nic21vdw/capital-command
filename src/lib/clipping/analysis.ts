import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import type { ClipCandidate, ClipScoreBreakdown } from "@/lib/clipping/types";

export type EnergyWindow = {
  /** Window start time in seconds. */
  time: number;
  /** RMS level in dBFS (negative; closer to 0 is louder). */
  rms: number;
};

export type SilenceRange = { start: number; end: number };

const WINDOW_SEC = 0.5;
// downloadAudio always produces 16 kHz mono, so a fixed-size frame of this many
// samples is exactly WINDOW_SEC long.
const WINDOW_SAMPLES = Math.round(WINDOW_SEC * 16000);
const MIN_CLIP_SEC = 15;
const MAX_CLIP_SEC = 60;
const TARGET_CLIP_SEC = 38;
const MAX_CANDIDATES = 6;

/** Extracts per-window RMS loudness for the first audio stream. */
export async function extractEnergy(inputPath: string): Promise<EnergyWindow[]> {
  const { stdout } = await runFfmpeg([
    "-hide_banner",
    "-i",
    inputPath,
    "-map",
    "a:0",
    "-af",
    // Re-chunk the audio into fixed WINDOW_SEC frames, then reset astats every
    // frame so each printed RMS describes exactly one window. (astats' own
    // `reset` is a FRAME count, not seconds — passing seconds left stats
    // cumulative, which biased every peak toward the start of the stream.)
    `asetnsamples=n=${WINDOW_SAMPLES}:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`,
    "-f",
    "null",
    "-"
  ]);

  const windows: EnergyWindow[] = [];
  let currentTime: number | null = null;
  for (const line of stdout.split("\n")) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) {
      currentTime = Number(timeMatch[1]);
      continue;
    }
    const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/);
    if (rmsMatch && currentTime !== null) {
      const rms = rmsMatch[1] === "-inf" ? -90 : Math.max(-90, Number(rmsMatch[1]));
      windows.push({ time: currentTime, rms });
      currentTime = null;
    }
  }
  return windows;
}

/** Detects silence ranges used to snap clip boundaries to natural pauses. */
export async function detectSilences(inputPath: string): Promise<SilenceRange[]> {
  const { stderr } = await runFfmpeg(
    ["-hide_banner", "-i", inputPath, "-map", "a:0", "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"],
    { allowFailure: true }
  );

  const ranges: SilenceRange[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*([\d.]+)/);
    if (start) {
      pendingStart = Number(start[1]);
      continue;
    }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && pendingStart !== null) {
      ranges.push({ start: pendingStart, end: Number(end[1]) });
      pendingStart = null;
    }
  }
  return ranges;
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return -90;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function percentileOf(sorted: number[], value: number) {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

function nearestBoundary(target: number, silences: SilenceRange[], maxDrift: number): number | null {
  let best: number | null = null;
  let bestDist = maxDrift;
  for (const range of silences) {
    const mid = (range.start + range.end) / 2;
    const dist = Math.abs(mid - target);
    if (dist < bestDist) {
      best = mid;
      bestDist = dist;
    }
  }
  return best;
}

function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }) {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union > 0 ? inter / union : 0;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Picks ranked clip candidates from audio energy peaks, snapping boundaries
 * to silences. All scores are derived from measured loudness — no guessing.
 */
export function selectCandidates(
  windows: EnergyWindow[],
  silences: SilenceRange[],
  durationSec: number
): ClipCandidate[] {
  if (windows.length === 0) return fallbackCandidates(durationSec, "No audio energy data was available");

  const sortedRms = windows.map((w) => w.rms).sort((a, b) => a - b);
  const p75 = percentile(sortedRms, 75);

  // Smooth energy over ~3s so single transients don't dominate peak picking.
  const smooth: number[] = windows.map((_, i) => {
    const span = Math.round(3 / WINDOW_SEC);
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - span); j <= Math.min(windows.length - 1, i + span); j++) {
      sum += windows[j].rms;
      count++;
    }
    return sum / count;
  });

  // Local maxima of smoothed energy above the 75th percentile.
  const peakGap = Math.round(MIN_CLIP_SEC / WINDOW_SEC);
  const peaks: number[] = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    if (smooth[i] < p75) continue;
    if (smooth[i] < smooth[i - 1] || smooth[i] < smooth[i + 1]) continue;
    if (peaks.length > 0 && i - peaks[peaks.length - 1] < peakGap) {
      if (smooth[i] > smooth[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  if (peaks.length === 0) {
    // Quiet/uniform audio: take the single loudest region instead.
    let bestIdx = 0;
    for (let i = 0; i < smooth.length; i++) if (smooth[i] > smooth[bestIdx]) bestIdx = i;
    peaks.push(bestIdx);
  }

  const candidates: ClipCandidate[] = [];
  for (const peakIdx of peaks) {
    const peakTime = windows[peakIdx].time;
    let start = Math.max(0, peakTime - TARGET_CLIP_SEC * 0.35);
    let end = Math.min(durationSec, start + TARGET_CLIP_SEC);

    const snappedStart = nearestBoundary(start, silences, 6);
    const snappedEnd = nearestBoundary(end, silences, 8);
    const startSnapped = snappedStart !== null && snappedStart < peakTime - 3;
    const endSnapped = snappedEnd !== null && snappedEnd > peakTime + 3;
    if (startSnapped) start = snappedStart as number;
    if (endSnapped) end = snappedEnd as number;
    start = Math.max(0, start);
    end = Math.min(durationSec, Math.max(end, start + MIN_CLIP_SEC));
    if (end - start > MAX_CLIP_SEC) end = start + MAX_CLIP_SEC;
    if (end - start < Math.min(MIN_CLIP_SEC, durationSec)) continue;

    const inClip = windows.filter((w) => w.time >= start && w.time <= end);
    if (inClip.length === 0) continue;
    const opening = inClip.filter((w) => w.time <= start + 4);
    const mean = inClip.reduce((sum, w) => sum + w.rms, 0) / inClip.length;
    const variance = inClip.reduce((sum, w) => sum + (w.rms - mean) ** 2, 0) / inClip.length;
    const openingMean = opening.length
      ? opening.reduce((sum, w) => sum + w.rms, 0) / opening.length
      : mean;

    const breakdown: ClipScoreBreakdown = {
      hook: Math.round(percentileOf(sortedRms, openingMean)),
      pacing: Math.round(Math.min(100, Math.sqrt(variance) * 14)),
      standalone: (startSnapped ? 50 : 20) + (endSnapped ? 50 : 20),
      intensity: Math.round(percentileOf(sortedRms, mean))
    };
    breakdown.standalone = Math.min(100, breakdown.standalone);
    const score = Math.round(
      breakdown.hook * 0.35 + breakdown.intensity * 0.3 + breakdown.pacing * 0.2 + breakdown.standalone * 0.15
    );

    const rationaleParts = [
      `Opens at the ${breakdown.hook}th loudness percentile of the stream`,
      breakdown.pacing >= 55 ? "high energy variation suggests fast pacing" : "steady delivery throughout",
      startSnapped && endSnapped
        ? "starts and ends on natural pauses"
        : startSnapped || endSnapped
          ? "one boundary lands on a natural pause"
          : "boundaries were energy-based (no clean pause nearby)"
    ];

    candidates.push({
      id: `clip-${candidates.length + 1}`,
      start: round1(start),
      end: round1(end),
      score,
      breakdown,
      rationale: rationaleParts.join("; ") + "."
    });
  }

  // Dedupe heavy overlaps, keep highest score, cap the list.
  candidates.sort((a, b) => b.score - a.score);
  const kept: ClipCandidate[] = [];
  for (const candidate of candidates) {
    if (kept.some((existing) => overlapRatio(existing, candidate) > 0.45)) continue;
    kept.push(candidate);
    if (kept.length >= MAX_CANDIDATES) break;
  }
  if (kept.length === 0) return fallbackCandidates(durationSec, "Energy analysis found no usable peaks");

  kept.sort((a, b) => b.score - a.score);
  return kept.map((candidate, index) => ({ ...candidate, id: `clip-${index + 1}` }));
}

/** Evenly spaced segments when there is no audio signal to score against. */
export function fallbackCandidates(durationSec: number, reason: string): ClipCandidate[] {
  const clipLen = Math.min(45, Math.max(10, durationSec));
  const count = Math.max(1, Math.min(3, Math.floor(durationSec / (clipLen * 1.5))));
  const candidates: ClipCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const start = round1(((i + 0.5) / count) * durationSec - clipLen / 2);
    const clampedStart = Math.max(0, Math.min(start, durationSec - clipLen));
    candidates.push({
      id: `clip-${i + 1}`,
      start: round1(clampedStart),
      end: round1(Math.min(durationSec, clampedStart + clipLen)),
      score: 0,
      breakdown: { hook: 0, pacing: 0, standalone: 0, intensity: 0 },
      rationale: `${reason} — fell back to evenly spaced segments. Review manually.`
    });
  }
  return candidates;
}
