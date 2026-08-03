import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  clearXaiSession,
  describeXaiAuth,
  importGrokCliSession,
  pollXaiDeviceLogin,
  startXaiDeviceLogin
} from "@/lib/voice/xaiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import") }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), deviceCode: z.string().trim().min(1) })
]);

export async function GET() {
  return NextResponse.json(await describeXaiAuth());
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400 });
  try {
    if (parsed.data.action === "import") {
      await importGrokCliSession();
      return NextResponse.json({ status: await describeXaiAuth() });
    }
    if (parsed.data.action === "start") {
      const login = await startXaiDeviceLogin();
      return NextResponse.json({
        deviceCode: login.deviceCode,
        userCode: login.userCode,
        verificationUri: login.verificationUri,
        verificationUriComplete: login.verificationUriComplete,
        interval: login.interval,
        expiresIn: login.expiresIn
      });
    }
    const result = await pollXaiDeviceLogin(parsed.data.deviceCode);
    if (result.pending) return NextResponse.json({ pending: true, slowDown: result.slowDown });
    return NextResponse.json({ pending: false, status: await describeXaiAuth() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The sign-in failed." }, { status: 502 });
  }
}

export async function DELETE() {
  await clearXaiSession();
  return NextResponse.json({ status: await describeXaiAuth() });
}
