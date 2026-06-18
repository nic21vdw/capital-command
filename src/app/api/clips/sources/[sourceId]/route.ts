import { NextResponse } from "next/server";
import { deleteSource, readSourceMeta } from "@/lib/clipping/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const meta = await readSourceMeta(sourceId);
  if (!meta) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  return NextResponse.json({ source: meta });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  await deleteSource(sourceId);
  return NextResponse.json({ ok: true });
}
