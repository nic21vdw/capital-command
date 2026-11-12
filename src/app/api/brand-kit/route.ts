import { NextResponse } from "next/server";
import { BrandKitConflictError, BrandKitInvalidError, brandKitResolution, saveBrandKitOverrides } from "@/lib/brand/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function snapshot() {
  const { kit, overrides, issues } = brandKitResolution();
  return { kit, overrides, issues };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body with an overrides object." }, { status: 400 });
  }
  const overrides = (body as { overrides?: unknown } | null)?.overrides;
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    return NextResponse.json({ error: "Send a JSON body with an overrides object." }, { status: 400 });
  }
  try {
    await saveBrandKitOverrides(overrides, (body as { expectedOverrides?: unknown }).expectedOverrides);
  } catch (error) {
    if (error instanceof BrandKitConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BrandKitInvalidError) {
      return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "The brand kit could not be saved." }, { status: 500 });
  }
  return NextResponse.json(snapshot());
}

// A scoped write from the editor keeps every other brand preference intact.
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.videoLooks) || !body.expectedOverrides || typeof body.expectedOverrides !== "object" || Array.isArray(body.expectedOverrides)) {
      return NextResponse.json({ error: "Send videoLooks and the expected brand overrides." }, { status: 400 });
    }
    await saveBrandKitOverrides({ videoLooks: body.videoLooks }, body.expectedOverrides, true);
    return NextResponse.json(snapshot());
  } catch (error) {
    if (error instanceof BrandKitConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof BrandKitInvalidError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
    return NextResponse.json({ error: "The brand kit could not be saved. Your saved kit was left untouched." }, { status: 500 });
  }
}
