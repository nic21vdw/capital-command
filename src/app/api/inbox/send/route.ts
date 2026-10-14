import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ReconnectNeededError, ReplyRefusedError, sendReply } from "@/lib/inbox/send";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ id: z.string().min(1), text: z.string(), confirm: z.literal(true) });

export async function POST(request: NextRequest) {
  if (!allowsRequestOrigin(request)) {
    return NextResponse.json({ error: "The inbox can only be changed from this app." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A reply is only sent on an explicit call: { id, text, confirm: true }." }, { status: 400 });
  }
  try {
    const result = await sendReply(parsed.data.id, parsed.data.text);
    return NextResponse.json({ ok: true, externalId: result.externalId ?? null, item: result.item });
  } catch (error) {
    if (error instanceof ReconnectNeededError) {
      return NextResponse.json({ error: error.message, reconnect: error.platform, kind: error.kind }, { status: 409 });
    }
    if (error instanceof ReplyRefusedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
