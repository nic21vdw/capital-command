import { NextRequest, NextResponse } from "next/server";
import { analyzeActivities, computeWeekStatus, localDateKey } from "@/lib/x-strategy/analytics";
import { assembleSessionBrief, generateSearchStrategy, strategyConfigured } from "@/lib/x-strategy/session-brief";
import { readAppData } from "@/lib/storage/store";

/**
 * Builds today's X Session Brief. Reads the current positioning brief, targets,
 * and reply log from the app data store, computes the rolling analysis, asks
 * Claude for search queries + accounts (when configured), and returns the
 * assembled copy-paste block. Never mutates data.
 */
export async function POST(request: NextRequest) {
  let focus = "";
  try {
    const body = (await request.json()) as { focus?: unknown };
    if (typeof body.focus === "string") focus = body.focus;
  } catch {
    // Empty/invalid body is fine — focus stays blank.
  }

  const data = await readAppData();
  const { brief, dailyReplyTarget, dailyPostTarget, activities } = data.xStrategy;
  const today = localDateKey();

  const analysis = analyzeActivities(activities, today);
  const week = computeWeekStatus(activities, dailyReplyTarget, dailyPostTarget, today);

  const { strategy, reason } = await generateSearchStrategy(brief, analysis, focus);

  const sessionBrief = assembleSessionBrief({
    brief,
    analysis,
    focus,
    strategy,
    today,
    remainingReplies: week.remainingReplies,
    remainingPosts: week.remainingPosts
  });

  return NextResponse.json({
    sessionBrief,
    strategy,
    reason,
    configured: strategyConfigured()
  });
}
