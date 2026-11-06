import { NextResponse } from "next/server";
import { bestTimesReport } from "@/lib/analytics/bestTimesApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await bestTimesReport(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The analytics store could not be read." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
