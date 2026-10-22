import { NextResponse } from "next/server";
import { CONNECTION_UNAVAILABLE } from "@/lib/integrations/marketing/contract";
import { marketingRuntime } from "@/lib/integrations/marketing/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * No runtime is installed by default. A trusted owner-process composition may
 * supply the authenticated adapter. Existing loopback middleware still applies.
 */
export function POST(request?: Request) {
  const runtime = marketingRuntime();
  if (runtime && request) return runtime.operations(request);
  return NextResponse.json({
    error: { code: "connection_unavailable", message: CONNECTION_UNAVAILABLE },
    executed: false
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
