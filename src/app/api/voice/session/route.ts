import { mutationOriginAllowed } from "@/lib/security/mutation-origin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { voiceProviderStatus } from "@/lib/voice/providers";
import { voiceInstructions } from "@/lib/voice/prompt";
import { createVoiceSession, revokeGrant } from "@/lib/voice/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  provider: z.enum(["openai", "xai"]).optional(),
  voice: z.string().trim().max(40).optional(),
  allowActions: z.boolean().optional()
});

export async function GET() {
  return NextResponse.json({ providers: await voiceProviderStatus() });
}

export async function POST(request: NextRequest) {
  if (!mutationOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin mutation refused." }, { status: 403 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid voice session request." }, { status: 400 });
  const allowActions = parsed.data.allowActions ?? false;
  try {
    const session = await createVoiceSession({
      providerId: parsed.data.provider ?? "openai",
      voice: parsed.data.voice,
      instructions: await voiceInstructions(allowActions),
      allowActions
    });
    return NextResponse.json({ ...session, allowActions }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start the voice session." }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!mutationOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin mutation refused." }, { status: 403 });
  }
  revokeGrant(request.nextUrl.searchParams.get("grantId") ?? undefined);
  return NextResponse.json({ ok: true });
}
