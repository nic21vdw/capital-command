import { aiConfigured, runAi } from "@/lib/ai";
import type { ClipCandidate } from "@/lib/clipping/types";

/**
 * Virality second pass. Moment selection (transcript-select / energy analysis)
 * produces a solid first cut; this pass re-reads each chosen clip's own
 * transcript and asks the model to judge how viral it actually is as a
 * standalone short — then re-ranks the set and folds a sharper-hook suggestion
 * into each clip's rationale.
 *
 * It exists because the free DeepSeek Flash provider makes a second model pass
 * essentially free: a dedicated "is this actually viral?" judgement catches
 * weak picks the single selection pass rates too highly and surfaces the real
 * bangers to the top. Degrades gracefully — when AI is unavailable or the reply
 * can't be read, the candidates are returned unchanged, so the pipeline never
 * regresses below its first cut.
 */

export function viralityRefinementConfigured(): boolean {
  return aiConfigured();
}

/** Longest clip-local transcript excerpt sent per clip. */
const MAX_EXCERPT_CHARS = 900;

export type ViralityVerdict = {
  id: string;
  /** 0-100 standalone virality judgement. */
  virality: number;
  /** Whether the clip is worth keeping near the top or should sink. */
  verdict: "keep" | "cut";
  /** One line on why. */
  reason?: string;
  /** A punchier opening line the editor could re-cut the clip to lead with. */
  hook?: string;
};

export type ViralityRequest = {
  id: string;
  transcript: string;
  /** The clip's current score, given to the model as prior context. */
  score: number;
};

export const VIRALITY_SYSTEM_PROMPT = `You are a ruthless short-form virality judge for YouTube Shorts, TikTok and Reels. You are given the transcripts of candidate clips already cut from a longer video. For each clip, judge how well it would perform as a STANDALONE short: does it hook in the first two seconds, is it self-contained, does it pay off, and would a scrolling viewer stop and watch to the end?

Be honest and discriminating — do not rate everything highly. Reserve 80+ for clips that genuinely stop the scroll. You always return strict JSON.`;

/** Builds the judging prompt. Pure, for tests. */
export function buildViralityPrompt(clips: ViralityRequest[], topic?: string): string {
  const lines: string[] = [];
  if (topic?.trim()) {
    lines.push(`The creator wants clips focused on: ${topic.trim()}. Weight relevance to that alongside raw virality.`, "");
  }
  lines.push(
    `Judge each of the ${clips.length} candidate clips below.`,
    "",
    'Return ONLY a JSON array (no prose): [{"id":"<clip id>","virality":0-100,"verdict":"keep"|"cut","reason":"one sentence","hook":"a punchier opening line for this clip"}] — one object per clip, keeping each id exactly as given. Mark "cut" only for clips that would flop as a standalone short.',
    ""
  );
  for (const clip of clips) {
    const excerpt = clip.transcript.replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
    lines.push(`Clip ${clip.id} (current score ${clip.score}):`, excerpt, "");
  }
  return lines.join("\n");
}

/** Pulls the id->verdict map out of the reply, tolerating fences / prose. */
export function parseViralityVerdicts(text: string): Map<string, ViralityVerdict> {
  const verdicts = new Map<string, ViralityVerdict>();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return verdicts;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(parsed)) return verdicts;
    for (const entry of parsed) {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (!id) continue;
      const rawVirality = Number(entry?.virality);
      const virality = Number.isFinite(rawVirality) ? Math.max(0, Math.min(100, Math.round(rawVirality))) : 60;
      const verdict = entry?.verdict === "cut" ? "cut" : "keep";
      const reason = typeof entry?.reason === "string" ? entry.reason.trim() : undefined;
      const hook = typeof entry?.hook === "string" ? entry.hook.trim() : undefined;
      verdicts.set(id, { id, virality, verdict, reason, hook });
    }
  } catch {
    // Unreadable reply — caller keeps the unrefined order.
  }
  return verdicts;
}

/**
 * Applies a verdict map to the candidates: blends the model's virality score
 * with the existing score, penalizes "cut" clips so they sink, folds the reason
 * and hook suggestion into the rationale, then re-sorts strongest-first and
 * re-ids so the UI numbering matches the new order. Pure, for tests.
 */
export function applyViralityVerdicts(
  candidates: ClipCandidate[],
  verdicts: Map<string, ViralityVerdict>
): ClipCandidate[] {
  if (verdicts.size === 0) return candidates;
  const scored = candidates.map((candidate) => {
    const verdict = verdicts.get(candidate.id);
    if (!verdict) return { candidate, sortScore: candidate.score };
    // Blend: the fresh virality judgement leads, the first-pass score anchors it.
    let blended = Math.round(candidate.score * 0.45 + verdict.virality * 0.55);
    if (verdict.verdict === "cut") blended = Math.round(blended * 0.5);
    blended = Math.max(0, Math.min(100, blended));

    const notes: string[] = [];
    if (verdict.reason) notes.push(`Viral re-rank (${verdict.virality}/100): ${verdict.reason}`);
    else notes.push(`Viral re-rank: ${verdict.virality}/100.`);
    if (verdict.hook) notes.push(`Stronger hook: "${verdict.hook}"`);
    const rationale = `${candidate.rationale} ${notes.join(" ")}`.trim();

    return { candidate: { ...candidate, score: blended, rationale }, sortScore: blended };
  });

  scored.sort((a, b) => b.sortScore - a.sortScore);
  return scored.map(({ candidate }, index) => ({ ...candidate, id: `clip-${index + 1}` }));
}

/**
 * Runs the virality second pass over already-selected candidates. `transcripts`
 * maps each candidate id to its clip-local transcript text. Returns re-ranked
 * candidates, or the input unchanged when AI is unavailable / the pass yields
 * nothing usable. Never throws.
 */
export async function refineClipVirality(
  candidates: ClipCandidate[],
  transcripts: Map<string, string>,
  topic?: string
): Promise<ClipCandidate[]> {
  if (!viralityRefinementConfigured() || candidates.length === 0) return candidates;

  const requests: ViralityRequest[] = candidates
    .map((candidate) => ({
      id: candidate.id,
      transcript: (transcripts.get(candidate.id) ?? "").trim(),
      score: candidate.score
    }))
    .filter((request) => request.transcript.length > 0);
  if (requests.length === 0) return candidates;

  try {
    const result = await runAi({
      maxTokens: 2000,
      system: VIRALITY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildViralityPrompt(requests, topic) }]
    });
    if (!result || result.refused) return candidates;
    const verdicts = parseViralityVerdicts(result.text);
    return applyViralityVerdicts(candidates, verdicts);
  } catch {
    return candidates;
  }
}
