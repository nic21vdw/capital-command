import { NextRequest, NextResponse } from "next/server";
import { queryAnalytics } from "@/lib/analytics/api";
import { parseSince, type AnalyticsQuery, type SortKey } from "@/lib/analytics/query";
import { ANALYTICS_PLATFORMS, type AnalyticsPlatform } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: SortKey[] = ["published", "views", "engagement", "title", "platform"];
const MAX_TOP = 500;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const now = new Date();
  const query: AnalyticsQuery = {};

  const platformParam = params.get("platform");
  if (platformParam) {
    const requested = platformParam.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
    const unknown = requested.filter((name) => !ANALYTICS_PLATFORMS.includes(name as AnalyticsPlatform));
    if (unknown.length > 0) return bad(`Unknown platform "${unknown[0]}". Use one of: ${ANALYTICS_PLATFORMS.join(", ")}.`);
    query.platform = requested as AnalyticsPlatform[];
  }

  const sinceParam = params.get("since");
  if (sinceParam) {
    const since = parseSince(sinceParam, now);
    if (!since) return bad(`"since" must be a number of days like 28d or a date like 2026-10-01.`);
    query.since = since;
  }

  const topParam = params.get("top");
  if (topParam !== null) {
    const top = Number(topParam);
    if (!Number.isInteger(top) || top < 1 || top > MAX_TOP) return bad(`"top" must be a whole number from 1 to ${MAX_TOP}.`);
    query.top = top;
  }

  const sortParam = params.get("sort");
  if (sortParam) {
    if (!SORTS.includes(sortParam as SortKey)) return bad(`"sort" must be one of: ${SORTS.join(", ")}.`);
    query.sort = sortParam as SortKey;
  }

  try {
    return NextResponse.json(await queryAnalytics(query, now), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The analytics store could not be read." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
