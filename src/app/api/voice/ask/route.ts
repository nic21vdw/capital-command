import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiProviderInfo } from "@/lib/ai";
import { issueGrant, readGrant } from "@/lib/voice/session";
import { runVoiceTurn } from "@/lib/voice/textAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  utterance: z.string().trim().min(1).max(4000),
  grantId: z.string().trim().min(1).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional()
});

export async function GET() {
  const info = aiProviderInfo();
  return NextResponse.json({ ...info, mode: "push-to-talk" });
}

/** Arming happens here, not in the page: the grant the tools check is server-held. */
export async function PUT() {
  const grant = issueGrant(true);
  return NextResponse.json({ grantId: grant.id, expiresAt: grant.expiresAt });
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid voice request." }, { status: 400 });
  const grant = readGrant(parsed.data.grantId);
  try {
    const turn = await runVoiceTurn({
      utterance: parsed.data.utterance,
      history: parsed.data.history,
      allowActions: Boolean(grant?.allowActions),
      baseUrl: request.nextUrl.origin
    });
    return NextResponse.json(turn);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The turn failed." }, { status: 502 });
  }
}
