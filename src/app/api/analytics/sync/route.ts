import { NextResponse } from "next/server";
import { requestSync } from "@/lib/analytics/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { started } = requestSync({ force: true });
  return NextResponse.json({ started, running: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
