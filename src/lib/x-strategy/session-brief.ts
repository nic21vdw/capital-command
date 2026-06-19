import Anthropic from "@anthropic-ai/sdk";
import type { XAnalysis } from "@/lib/x-strategy/analytics";

/**
 * Server-side assembly of the daily X "Session Brief" — the copy-paste block
 * the user pastes into a human-reviewed Claude browser session. The AI step
 * (search queries + accounts) degrades gracefully: if it can't run, the brief
 * is still produced from the static positioning brief.
 */

export function strategyConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const EXECUTION_INSTRUCTIONS = `EXECUTION INSTRUCTIONS FOR THIS SESSION
1. Search recent X posts using the suggested queries above and check the suggested accounts directly.
2. Evaluate each candidate: read the full post, any linked material, and enough of the thread for context.
3. Score each candidate out of 100 on: relevance to my positioning, freshness, author credibility, my ability to add an original engineering / professional-workflow insight, probability of creating a real conversation, and risk of sounding generic or self-promotional.
4. Only proceed if the best opportunity scores at least 80/100. If nothing clears 80, report that and stop.
5. Draft THREE possible replies privately, following all voice rules (2-4 sentences, no hashtags/emojis, no generic openers, no sales pitch, no invented facts).
6. Critique the three drafts for generic language, unsupported claims, and AI-sounding phrasing.
7. Choose and refine the single strongest reply.
8. Enter it into the X composer and re-read it alongside the original post.
9. Post it, then come back and log it in Nic Vandewetering (Reply tab).
10. Report back: account replied to, a summary of the original post, the exact reply you posted, why this was the strongest opportunity, and one possible follow-up if the author replies.`;

export async function generateSearchStrategy(
  brief: string,
  analysis: XAnalysis,
  focus: string
): Promise<{ strategy: string | null; reason: string | null }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      strategy: null,
      reason:
        "AI search suggestions skipped: set ANTHROPIC_API_KEY in .env to generate today's search queries and account picks."
    };
  }

  const accountsAvoid = analysis.accountsLast7Days.join(", ") || "(none yet)";
  const topicsRecent = analysis.topicsLast14Days.join(", ") || "(none yet)";
  const focusLine = focus.trim() || "(open — no specific focus today)";

  const userPrompt = `Here is my X positioning and reply strategy:

${brief}

Recent reply history (to avoid repeating):
- Accounts I replied to in the last 7 days: ${accountsAvoid}
- Topics I covered in the last 14 days: ${topicsRecent}

Today's focus topic: ${focusLine}

Given this positioning and recent reply history, generate 5 specific X search queries I should run today to find strong reply opportunities. Also suggest 3 accounts I should check directly based on the positioning context (avoid the accounts I replied to in the last 7 days). Prefer fresh angles over topics I already covered recently, and lean toward today's focus topic if one is given.

Format your answer as a ready-to-use list with two clearly labelled sections: "SEARCH QUERIES" (numbered 1-5) and "ACCOUNTS TO CHECK" (3 handles, each with a one-line reason). Do not add any other commentary.`;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      system:
        "You are a sharp social-media strategist helping a structural engineer who builds AI tooling find high-quality reply opportunities on X. Be specific and practical.",
      messages: [{ role: "user", content: userPrompt }]
    });

    if (response.stop_reason === "refusal") {
      return { strategy: null, reason: "AI search suggestions skipped: the model declined this request." };
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n")
      .trim();

    if (!text) {
      return { strategy: null, reason: "AI search suggestions failed: the model returned no text." };
    }
    return { strategy: text, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { strategy: null, reason: `AI search suggestions failed: ${message}. Using the static brief instead.` };
  }
}

export function assembleSessionBrief(input: {
  brief: string;
  analysis: XAnalysis;
  focus: string;
  strategy: string | null;
  today: string;
  remainingReplies: number;
  remainingPosts: number;
}): string {
  const { brief, analysis, focus, strategy, today, remainingReplies, remainingPosts } = input;
  const accountsAvoid = analysis.accountsLast7Days.join(", ") || "(none)";
  const topicsRecent = analysis.topicsLast14Days.join(", ") || "(none)";
  const focusLine = focus.trim() || "(open — no specific focus today)";
  const flags =
    analysis.frequentAccounts.length > 0
      ? analysis.frequentAccounts.map((entry) => `${entry.account} (${entry.count}x in 30d)`).join(", ")
      : "(none)";

  const strategyBlock =
    strategy ??
    "(AI-generated suggestions unavailable for this session.)\nFall back to the 'Search topics' and 'Accounts to check regularly' sections in my brief above to choose what to search and check today.";

  const divider = "=".repeat(70);

  return `${divider}
DAILY X SESSION BRIEF — ${today}
${divider}

--- MY POSITIONING & STRATEGY ---
${brief}

--- TODAY'S CONTEXT ---
Date: ${today}
Today's focus topic: ${focusLine}
Today's remaining targets: ${remainingReplies} repl${remainingReplies === 1 ? "y" : "ies"} + ${remainingPosts} post${remainingPosts === 1 ? "" : "s"} (minimum, includes catch-up).

Accounts to AVOID this week (replied to in the last 7 days):
${accountsAvoid}

Topics already covered recently (last 14 days):
${topicsRecent}

Accounts I've leaned on a lot (flagged, >2x in 30 days):
${flags}

--- SUGGESTED SEARCH STRATEGY ---
${strategyBlock}

--- ${EXECUTION_INSTRUCTIONS}
${divider}`;
}
