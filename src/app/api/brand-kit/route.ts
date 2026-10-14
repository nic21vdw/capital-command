import { NextResponse } from "next/server";
import { BrandKitInvalidError, brandKitResolution, saveBrandKitOverrides } from "@/lib/brand/kit";

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
    await saveBrandKitOverrides(overrides);
  } catch (error) {
    if (error instanceof BrandKitInvalidError) {
      return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "The brand kit could not be saved." }, { status: 500 });
  }
  return NextResponse.json(snapshot());
}
