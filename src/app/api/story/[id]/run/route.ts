import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { runStages } from "@/lib/story/pipeline";
import { readStatus, type StoryStage } from "@/lib/story/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: Record<string, StoryStage[]> = {
  rerender: ["edit", "render", "verify", "frames", "package"],
  repackage: ["copy", "package"],
  upload: ["package", "upload", "package"],
  full: ["analyze", "score", "story", "edit", "copy", "render", "verify", "frames", "package"]
};

const schema = z.object({ action: z.enum(["rerender", "repackage", "upload", "full"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const status = await readStatus(id);
  if (!status) return NextResponse.json({ error: "Story project not found." }, { status: 404 });
  if (status.busy) return NextResponse.json({ error: "Already running." }, { status: 409 });
  void runStages(id, ACTIONS[parsed.data.action], { accessToken: () => youtubeAccessToken() }).catch(() => undefined);
  return NextResponse.json({ started: parsed.data.action }, { status: 202 });
}
