import { marketingRuntime } from "@/lib/integrations/marketing/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const adapter = marketingRuntime();
  if (adapter) return adapter.records(request);
  return Response.json({ ok: false, error: { code: "connection_unavailable", message: "The authenticated reader is not configured.", retryable: false, outcome: "failed" } }, { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
