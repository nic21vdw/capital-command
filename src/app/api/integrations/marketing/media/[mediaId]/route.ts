import { marketingRuntime } from "@/lib/integrations/marketing/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ mediaId: string }> }) {
  const adapter = marketingRuntime();
  if (adapter) return adapter.media(request, (await context.params).mediaId);
  return Response.json({ ok: false, error: { code: "connection_unavailable", message: "The authenticated reader is not configured.", retryable: false, outcome: "failed" } }, { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export const HEAD = GET;
