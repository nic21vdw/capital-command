import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureVerticalClipFile, outputDir } from "@/lib/clipping/jobs";
import { createExperiment } from "@/lib/experiments/create";
import { experimentReports } from "@/lib/experiments/service";
import { EXPERIMENT_KINDS } from "@/lib/experiments/types";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { ALL_PLATFORMS } from "@/lib/publisher/types";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const platform = z.enum(ALL_PLATFORMS as [string, ...string[]]);

const schema = z.object({
  kind: z.enum(EXPERIMENT_KINDS),
  jobId: z.string().min(1),
  file: z.string().min(1),
  clipId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  sourceLabel: z.string().optional(),
  baseTitle: z.string().min(1),
  baseCaption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  variants: z.array(z.object({ value: z.string(), origin: z.enum(["original", "ai", "edited"]) })),
  platforms: z.array(platform),
  accountIds: z.record(z.string(), z.string()).optional()
});

export async function GET() {
  try {
    return NextResponse.json({ generatedAt: new Date().toISOString(), experiments: await experimentReports() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The experiments could not be read." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!allowsRequestOrigin(request)) return NextResponse.json({ error: "An experiment must be started from this app." }, { status: 403 });
  if (!publisherConfig().enabled) return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That is not a valid experiment request." }, { status: 400 });
  const body = parsed.data;

  const base = outputDir(body.jobId);
  const resolved = path.resolve(base, body.file);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) return NextResponse.json({ error: "Invalid file name." }, { status: 400 });

  try {
    const vertical = await ensureVerticalClipFile(body.jobId, body.file);
    const { experiment, items } = await createExperiment({
      kind: body.kind,
      clipPath: path.resolve(base, vertical),
      jobId: body.jobId,
      clipId: body.clipId,
      file: body.file,
      runId: body.runId,
      sourceLabel: body.sourceLabel?.trim() || body.baseTitle,
      baseTitle: body.baseTitle,
      baseCaption: body.baseCaption,
      hashtags: body.hashtags,
      variants: body.variants,
      platforms: body.platforms as Parameters<typeof createExperiment>[0]["platforms"],
      accountIds: body.accountIds
    });
    return NextResponse.json(
      { experiment, booked: items.map((item) => ({ id: item.id, publishAt: item.publishAt, platforms: Object.keys(item.platforms) })) },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
