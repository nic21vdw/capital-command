import { NextResponse } from "next/server";
import { unavailableWorkspace } from "@/lib/integrations/marketing/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No ledger reader is installed. In particular, do not call runOverview here. */
export function GET() {
  return NextResponse.json(unavailableWorkspace(), { headers: { "Cache-Control": "no-store" } });
}
