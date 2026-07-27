import { aiConfigured, runAi } from "@/lib/ai";
import { describeReportForPrompt, type CompetitorTrendReport } from "@/lib/youtube/competitor-trends";

/**
 * AI layer of the competition analysis: turns the heuristic trend report into
 * concrete "do this in your next video" recommendations. Mirrors the
 * x-strategy session-brief pattern — gated on ANTHROPIC_API_KEY, degrades
 * gracefully (the heuristic report renders either way), never throws.
 */

export const COMPETITOR_INSIGHTS_MODEL = "claude-opus-4-8";

export function competitorInsightsConfigured(): boolean {
  return aiConfigured();
}

const SYSTEM_PROMPT =
  "You are a sharp YouTube strategy analyst. Your client is a creator making videos about AI-assisted coding " +
  "(“vibe coding”), building apps and businesses with AI, and practical AI tooling. You are given aggregated " +
  "public stats about competitor channels in that space: which of their videos broke out far above their own " +
  "channel baselines, and the topic/packaging patterns across those breakouts. Be specific and practical — " +
  "every recommendation must trace back to the data given. Never invent videos, channels, or numbers.";

export async function generateCompetitorInsights(
  report: CompetitorTrendReport
): Promise<{ insights: string | null; reason: string | null }> {
  if (!competitorInsightsConfigured()) {
    return { insights: null, reason: "AI insights skipped: no AI provider is configured." };
  }

  const userPrompt = `Here is the aggregated competition data (all figures are real, pulled from the YouTube Data API):

${describeReportForPrompt(report)}

Based only on this data, write a competition brief for my next uploads with exactly these markdown sections:

## Cross-channel trends
What multiple competitors are winning with at the same time — topics and formats. Call out when a pattern spans several channels versus being one channel's outlier.

## What's working
The packaging and format lessons from the breakout videos: title constructions, hooks, lengths, and why they likely worked.

## Next video ideas
5 concrete video ideas for MY channel. For each: a ready-to-use title, the format (Short or long-form), and one line on which competitor evidence justifies it.

## Gaps and opportunities
Angles the competitors' breakouts point toward but none of them has fully covered — where I can be first instead of derivative.

Keep it tight and skimmable. No preamble before the first section.`;

  try {
    const result = await runAi({
      maxTokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });

    if (!result || result.refused) {
      return { insights: null, reason: "AI insights skipped: the model was unavailable or declined this request." };
    }

    const text = result.text.trim();

    if (!text) return { insights: null, reason: "AI insights failed: the model returned no text." };
    return { insights: text, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { insights: null, reason: `AI insights failed: ${message}` };
  }
}
