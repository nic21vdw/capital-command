import { NextRequest, NextResponse } from "next/server";
import { mergeContacts } from "@/lib/outreach/model";
import { updateOutreachStore } from "@/lib/outreach/store";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/outreach/import — merge a batch of contacts, deduped by url.
 * Body: an array of contacts, or { contacts: [...] }. Same merge as
 * `npm run outreach:import -- <file>`; rows that fail validation are reported
 * back by index rather than dropped silently.
 */
export async function POST(request: NextRequest) {
  if (!allowsRequestOrigin(request)) {
    return NextResponse.json({ error: "Outreach can only be changed from this app." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as unknown;
  const rows = Array.isArray(body) ? body : (body as { contacts?: unknown } | null)?.contacts;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Send a JSON array of contacts, or { contacts: [...] }." }, { status: 400 });
  }
  try {
    let summary = { added: 0, updated: 0, skipped: [] as { index: number; reason: string }[] };
    const store = await updateOutreachStore((current) => {
      const result = mergeContacts(current.contacts, rows);
      summary = { added: result.added, updated: result.updated, skipped: result.skipped };
      return { ...current, contacts: result.contacts };
    });
    return NextResponse.json({ ...store, ...summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
