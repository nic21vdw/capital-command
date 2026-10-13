import { NextResponse } from "next/server";
import { platformHealth } from "@/lib/platform-health/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await platformHealth(), { headers: { "Cache-Control": "no-store" } });
}
