import { NextRequest, NextResponse } from "next/server";
import { longformTopicPlanSchema } from "@/lib/longform/schemas";
import { getProject, planProjectTopics } from "@/lib/longform/store";
import { DEFAULT_TOPIC_OPTIONS, type TopicPlanOptions } from "@/lib/longform/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  // `null` means the planner has not finished (or run) yet, which is different
  // from an empty array — that one means it ran and found nothing to split.
  return NextResponse.json({ topics: project.topics ?? null, note: project.topicsNote ?? null });
}

/** Plans (or replans) the recording's topic segments from its transcript. */
export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.status !== "ready") {
    return NextResponse.json({ error: "This video is still being analyzed." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = longformTopicPlanSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected an optional `count` and `targetMinutes`." }, { status: 400 });
  }

  // Asking for segments by hand overrides the "this is one video" floor: the
  // planner refuses short recordings on its own, but a request names one.
  const options: TopicPlanOptions = {};
  if (parsed.data.count || parsed.data.targetMinutes) options.minTotalSec = 0;
  if (parsed.data.count) {
    options.minCount = parsed.data.count;
    options.maxCount = parsed.data.count;
  }
  if (parsed.data.targetMinutes) {
    const targetSec = Math.round(parsed.data.targetMinutes * 60);
    options.targetSec = targetSec;
    // Keep the caps consistent with a hand-picked target length.
    options.minSec = Math.min(DEFAULT_TOPIC_OPTIONS.minSec, Math.round(targetSec / 2));
    options.maxSec = Math.max(DEFAULT_TOPIC_OPTIONS.maxSec, targetSec * 2);
  }

  try {
    const updated = await planProjectTopics(projectId, options);
    if (!updated) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ topics: updated.topics ?? [], note: updated.topicsNote ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not find the topic segments." },
      { status: 500 }
    );
  }
}
