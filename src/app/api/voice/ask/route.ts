import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiProviderInfo } from "@/lib/ai";
import { describeGrant, issueGrant, readGrant } from "@/lib/voice/session";
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

/** Also how the bar re-checks a grant it is still showing as armed. */
export async function GET(request: NextRequest) {
  const info = aiProviderInfo();
  const grantId = request.nextUrl.searchParams.get("grantId") ?? undefined;
  return NextResponse.json({ ...info, mode: "push-to-talk", grant: describeGrant(grantId, readGrant(grantId)) });
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
    // The turn carries the grant's real state back, so a bar that still says
    // "Can act" corrects itself on the very send that would have degraded.
    return NextResponse.json({ ...turn, grant: describeGrant(parsed.data.grantId, grant) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The turn failed." }, { status: 502 });
  }
}
