import { NextRequest, NextResponse } from "next/server";
import { competitorInsightsConfigured, generateCompetitorInsights, COMPETITOR_INSIGHTS_MODEL } from "@/lib/youtube/competitor-insights";
import { buildCompetitorTrendReport, normalizeGroupLabel, selectCompetitorChannels } from "@/lib/youtube/competitor-trends";
import type { CompetitorInsight } from "@/lib/youtube/outliers";
import { readOutlierStore, updateOutlierStore } from "@/lib/youtube/outlier-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SAVED_INSIGHTS = 12;

/**
 * POST /api/youtube/outliers/competitor-insights — { group?: string | null }.
 * Rebuilds the trend report server-side from the stored watchlist + outliers,
 * asks Claude for a competition brief, persists it (AI calls cost money; the
 * heuristic report is recomputed for free), and returns it.
 */
export async function POST(request: NextRequest) {
  let group: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { group?: unknown };
    if (typeof body.group === "string") group = normalizeGroupLabel(body.group) || null;
  } catch {
    // Empty/invalid body = analyze all labeled channels.
  }

  const store = await readOutlierStore();
  const channels = selectCompetitorChannels(store.channels, group);
  if (channels.length === 0) {
    return NextResponse.json(
      {
        error:
          group === null
            ? "The watchlist is empty — add competitor channels first."
            : `No channels labeled “${group}” — clear the group filter or label channels in the watchlist.`
      },
      { status: 400 }
    );
  }

  const report = buildCompetitorTrendReport(store.channels, store.outliers, { group });
  if (report.outlierCount === 0) {
    return NextResponse.json(
      { error: "No flagged outliers for that group yet — run a stats pull first." },
      { status: 400 }
    );
  }

  if (!competitorInsightsConfigured()) {
    return NextResponse.json(
      { error: "AI insights need ANTHROPIC_API_KEY set in .env.local. The trend breakdown on the page works without it." },
      { status: 400 }
    );
  }

  const { insights, reason } = await generateCompetitorInsights(report);
  if (!insights) {
    return NextResponse.json({ error: reason ?? "AI insights failed." }, { status: 502 });
  }

  const saved: CompetitorInsight = {
    id: `ci-${crypto.randomUUID()}`,
    group,
    generatedAt: new Date().toISOString(),
    model: COMPETITOR_INSIGHTS_MODEL,
    insights,
    outlierCount: report.outlierCount,
    channelCount: report.channelCount
  };
  const next = await updateOutlierStore((current) => ({
    ...current,
    competitorInsights: [saved, ...current.competitorInsights].slice(0, MAX_SAVED_INSIGHTS)
  }));

  return NextResponse.json({ insight: saved, competitorInsights: next.competitorInsights });
}
