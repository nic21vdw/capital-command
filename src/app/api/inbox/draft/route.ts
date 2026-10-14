import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DraftUnavailableError, draftReply } from "@/lib/inbox/draft";
import { readInbox } from "@/lib/inbox/store";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ id: z.string().min(1) });

export async function POST(request: NextRequest) {
  if (!allowsRequestOrigin(request)) {
    return NextResponse.json({ error: "The inbox can only be changed from this app." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { id }." }, { status: 400 });
  try {
    const item = (await readInbox()).items.find((candidate) => candidate.id === parsed.data.id);
    if (!item) return NextResponse.json({ error: `${parsed.data.id} is not in the inbox.` }, { status: 404 });
    return NextResponse.json({ draft: await draftReply(item) });
  } catch (error) {
    const status = error instanceof DraftUnavailableError ? 503 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
