import { NextResponse } from "next/server";
import { CONNECTION_UNAVAILABLE } from "@/lib/integrations/marketing/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reserved, disabled seam. No body is dispatched, no env flag enables it, and
 * the existing loopback mutation middleware still guards it. Origin is not auth.
 */
export function POST() {
  return NextResponse.json({
    error: { code: "connection_unavailable", message: CONNECTION_UNAVAILABLE },
    executed: false
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
