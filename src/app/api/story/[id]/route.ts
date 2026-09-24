import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clampZoom } from "@/lib/story/edl";
import { editStage, type Analysis, type Verification } from "@/lib/story/pipeline";
import { packageFile, projectFile, readJson, readOverrides, readStatus, writeOverrides } from "@/lib/story/store";
import type { Chapter, Edl, StoryCopy, StoryPlan, Unit } from "@/lib/story/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function payload(id: string) {
  const status = await readStatus(id);
  if (!status) return null;
  const analysis = await readJson<Analysis>(projectFile(id, "analysis.json"));
  const plan = await readJson<StoryPlan>(projectFile(id, "story.json"));
  const edl = await readJson<Edl>(packageFile(id, "edl.json"));
  const inPlan = new Set(
    plan && analysis
      ? plan.sections
          .flatMap((section) => section.momentIds)
          .flatMap((momentId) => analysis.moments.find((moment) => moment.id === momentId)?.unitIds ?? [])
      : []
  );
  const retakeGroups = new Set(analysis?.units.filter((unit) => inPlan.has(unit.id) && unit.retakeGroup).map((unit) => unit.retakeGroup));
  const hookCandidates = analysis
    ? [...analysis.units]
        .filter((unit) => !unit.retakeOf && unit.end - unit.start >= 5 && unit.end - unit.start <= 30)
        .sort((a, b) => b.scores.combined - a.scores.combined)
        .slice(0, 25)
    : [];
  const units: Unit[] = analysis
    ? analysis.units.filter(
        (unit) => inPlan.has(unit.id) || (unit.retakeGroup && retakeGroups.has(unit.retakeGroup)) || plan?.hookUnitIds.includes(unit.id)
      )
    : [];
  return {
    status,
    plan,
    edl,
    units,
    hookCandidates,
    chapters: await readJson<Chapter[]>(projectFile(id, "chapters.json")),
    copy: await readJson<StoryCopy>(projectFile(id, "copy.json")),
    verification: await readJson<Verification>(projectFile(id, "verification.json")),
    frames: await readJson<Array<{ file: string; seconds: number; reason: string }>>(projectFile(id, "frames.json")),
    youtube: await readJson<Record<string, unknown>>(packageFile(id, "youtube.json")),
    overrides: await readOverrides(id),
    rendered: await readJson<{ renderedAt: string }>(projectFile(id, "render.json"))
  };
}

export type StoryPayload = NonNullable<Awaited<ReturnType<typeof payload>>>;

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await payload(id);
    if (!body) return NextResponse.json({ error: "Story project not found." }, { status: 404 });
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the project." }, { status: 400 });
  }
}

const patchSchema = z.object({
  disabledUnitIds: z.array(z.string()).optional(),
  hookUnitIds: z.array(z.string()).max(6).optional(),
  takeChoices: z.record(z.string(), z.string()).optional(),
  zoom: z.record(z.string(), z.number().min(1).max(1.2)).optional()
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid override." }, { status: 400 });
  const status = await readStatus(id);
  if (!status) return NextResponse.json({ error: "Story project not found." }, { status: 404 });
  if (status.busy) return NextResponse.json({ error: "The project is busy; wait for the current step to finish." }, { status: 409 });
  const current = await readOverrides(id);
  const zoom = { ...current.zoom, ...(parsed.data.zoom ?? {}) };
  await writeOverrides(id, {
    disabledUnitIds: parsed.data.disabledUnitIds ?? current.disabledUnitIds,
    hookUnitIds: parsed.data.hookUnitIds ?? current.hookUnitIds,
    takeChoices: { ...current.takeChoices, ...(parsed.data.takeChoices ?? {}) },
    zoom: Object.fromEntries(Object.entries(zoom).map(([key, value]) => [key, clampZoom(value)]))
  });
  try {
    await editStage(id, () => undefined);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not rebuild the edit." }, { status: 400 });
  }
  return NextResponse.json(await payload(id));
}
