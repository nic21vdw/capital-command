import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { CLIP_LAYOUTS, DEFAULT_CLIP_LAYOUT } from "@/lib/clipping/layouts";
import { createJobFromUrl, listJobs } from "@/lib/clipping/jobs";
import type { ClipLayoutLayerOverride, ClipLayoutOverrides, ClipLayoutPreset } from "@/lib/clipping/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

function parseUnitRect(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const rect = value as Record<string, unknown>;
  const x = typeof rect.x === "number" ? rect.x : Number.NaN;
  const y = typeof rect.y === "number" ? rect.y : Number.NaN;
  const w = typeof rect.w === "number" ? rect.w : Number.NaN;
  const h = typeof rect.h === "number" ? rect.h : Number.NaN;
  if (![x, y, w, h].every(Number.isFinite)) return undefined;
  const clampedX = Math.min(0.99, Math.max(0, x));
  const clampedY = Math.min(0.99, Math.max(0, y));
  return {
    x: clampedX,
    y: clampedY,
    w: Math.max(0.01, Math.min(1 - clampedX, w)),
    h: Math.max(0.01, Math.min(1 - clampedY, h))
  };
}

function parseLayoutOverrides(value: unknown): ClipLayoutOverrides | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const parsed: ClipLayoutOverrides = {};

  for (const layout of Object.keys(CLIP_LAYOUTS) as ClipLayoutPreset[]) {
    const layoutValue = source[layout];
    if (!layoutValue || typeof layoutValue !== "object") continue;
    const layers = (layoutValue as { layers?: unknown }).layers;
    if (!Array.isArray(layers)) continue;
    const parsedLayers: ClipLayoutLayerOverride[] = layers.map((layer) => {
      if (!layer || typeof layer !== "object") return {};
      const layerRecord = layer as Record<string, unknown>;
      const sourceRect = parseUnitRect(layerRecord.source);
      const destRect = parseUnitRect(layerRecord.dest);
      const parsedLayer: ClipLayoutLayerOverride = {};
      if (sourceRect) parsedLayer.source = sourceRect;
      if (destRect) parsedLayer.dest = destRect;
      if (layerRecord.fit === "cover" || layerRecord.fit === "contain") parsedLayer.fit = layerRecord.fit;
      return parsedLayer;
    });
    parsed[layout] = { layers: parsedLayers };
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }
  try {
    // Cheap availability probe so a missing binary fails fast.
    await runFfmpeg(["-version"], { allowFailure: true });
  } catch {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }

  let body: {
    url?: unknown;
    topic?: unknown;
    renderLayout?: unknown;
    renderVariants?: unknown;
    layoutOverrides?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `url` field." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const renderLayout =
    typeof body.renderLayout === "string" && body.renderLayout in CLIP_LAYOUTS
      ? (body.renderLayout as ClipLayoutPreset)
      : DEFAULT_CLIP_LAYOUT;
  const renderVariants = Boolean(body.renderVariants);
  const layoutOverrides = parseLayoutOverrides(body.layoutOverrides);
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return NextResponse.json({ error: "Enter a valid http(s) video/VOD URL." }, { status: 400 });
  }

  const job = await createJobFromUrl(url, topic || undefined, { renderLayout, renderVariants, layoutOverrides });
  return NextResponse.json({ job }, { status: 201 });
}
