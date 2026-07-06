import { NextRequest, NextResponse } from "next/server";
import { longformPaceSchema } from "@/lib/longform/schemas";
import { replanProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rebuilds the cut plan from the cached silences with new pace settings. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with pace settings." }, { status: 400 });
  }
  const parsed = longformPaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pace settings." }, { status: 400 });
  }
  try {
    const project = await replanProject(projectId, parsed.data);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
