import { NextResponse } from "next/server";
import { unavailableWorkspace } from "@/lib/integrations/marketing/contract";
import { marketingRuntime } from "@/lib/integrations/marketing/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Side-effect-free adapter reader. Never use runOverview for a status read. */
export function GET(request?: Request) {
  const runtime = marketingRuntime();
  if (runtime && request) return runtime.workspace(request);
  return NextResponse.json(unavailableWorkspace(), { headers: { "Cache-Control": "no-store" } });
}
