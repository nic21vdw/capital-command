import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adoptWorkspace,
  getWorkspaceStatus,
  moveWorkspace,
  resetWorkspaceToDefault
} from "@/lib/storage/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getWorkspaceStatus());
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), targetPath: z.string().min(1) }),
  z.object({ action: z.literal("adopt"), targetPath: z.string().min(1) }),
  z.object({ action: z.literal("reset") })
]);

export async function POST(request: NextRequest) {
  let body;
  try {
    body = actionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    if (body.action === "move") {
      const result = await moveWorkspace(body.targetPath.trim());
      return NextResponse.json({ ...(await getWorkspaceStatus()), filesCopied: result.filesCopied });
    }
    if (body.action === "adopt") {
      await adoptWorkspace(body.targetPath.trim());
      return NextResponse.json(await getWorkspaceStatus());
    }
    await resetWorkspaceToDefault();
    return NextResponse.json(await getWorkspaceStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Storage operation failed." }, { status: 400 });
  }
}
