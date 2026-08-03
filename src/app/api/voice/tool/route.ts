import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readGrant } from "@/lib/voice/session";
import { runVoiceTool } from "@/lib/voice/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  grantId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  arguments: z.record(z.unknown()).optional()
});

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid tool call." }, { status: 400 });
  const grant = readGrant(parsed.data.grantId);
  if (!grant) return NextResponse.json({ ok: false, error: "This voice session has expired. Start it again." }, { status: 401 });
  try {
    const result = await runVoiceTool(parsed.data.name, parsed.data.arguments ?? {}, {
      allowActions: grant.allowActions,
      baseUrl: request.nextUrl.origin
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "The tool failed." });
  }
}
