import { NextRequest, NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai";
import { generateLaunchCopy } from "@/lib/launch/copy";
import { fetchLaunchStats, productHuntConfigured } from "@/lib/launch/producthunt";

/**
 * The two outward-facing halves of Launch Pad: writing the listing kit, and
 * reading the live standing off Product Hunt. Neither writes to the app data
 * store — the page persists whatever it keeps through /api/data, so the same
 * upsert path guards it as every other collection.
 *
 * Product Hunt has no public write API for creating a launch, so nothing here
 * can publish. Submitting the listing stays a manual step, by design.
 */
export async function GET() {
  return NextResponse.json({ aiConfigured: aiConfigured(), productHuntConfigured: productHuntConfigured() });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");

  if (action === "copy") {
    const product = text("product");
    if (!product) {
      return NextResponse.json({ error: "Product name is required." }, { status: 400 });
    }
    const copy = await generateLaunchCopy({
      product,
      productUrl: text("productUrl"),
      audience: text("audience"),
      whatItDoes: text("whatItDoes"),
      differentiator: text("differentiator")
    });
    return NextResponse.json({ copy, aiConfigured: aiConfigured() });
  }

  if (action === "stats") {
    if (!productHuntConfigured()) {
      return NextResponse.json({ error: "Set PRODUCT_HUNT_TOKEN to read live launch stats." }, { status: 400 });
    }
    try {
      const stats = await fetchLaunchStats(text("slug"));
      return NextResponse.json({ stats });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to reach Product Hunt." }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
