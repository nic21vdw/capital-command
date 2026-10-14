import { NextResponse, type NextRequest } from "next/server";
import { attributionPostLabels } from "@/lib/attribution/posts";
import { fetchAttributionSummary, lastDays } from "@/lib/attribution/readback";
import { joinAttribution, totalsOf } from "@/lib/attribution/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

function windowDays(raw: string | null): number {
  const days = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(days) || days < 1) return DEFAULT_DAYS;
  return Math.min(days, MAX_DAYS);
}

export async function GET(request: NextRequest) {
  const result = await fetchAttributionSummary(lastDays(windowDays(request.nextUrl.searchParams.get("days"))));
  if (result.status === "disabled") return NextResponse.json({ status: "disabled" });
  if (result.status === "unavailable") {
    return NextResponse.json({ status: "unavailable", reason: result.reason, message: result.message });
  }
  const { summary } = result;
  return NextResponse.json({
    status: "ok",
    from: summary.from,
    to: summary.to,
    lines: joinAttribution(summary.rows, await attributionPostLabels()),
    totals: totalsOf(summary.rows)
  });
}
