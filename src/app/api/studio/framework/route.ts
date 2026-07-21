import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { DEFAULT_SCRIPT_FRAMEWORK, defaultVideoStudio } from "@/lib/storage/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves the channel script framework (empty body text resets to the default). */
export async function PUT(request: NextRequest) {
  let framework = "";
  try {
    const body = (await request.json()) as { framework?: unknown };
    if (typeof body.framework === "string") framework = body.framework;
  } catch {
    // Treated as a reset below.
  }
  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  const nextFramework = framework.trim() ? framework : DEFAULT_SCRIPT_FRAMEWORK;
  await writeAppData({ ...data, videoStudio: { ...studio, framework: nextFramework } });
  return NextResponse.json({ framework: nextFramework });
}
