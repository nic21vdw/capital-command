import { NextResponse } from "next/server";
import { readUpdateHistory } from "@/lib/release/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ updates: await readUpdateHistory() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Update history could not be read. Try again." }, { status: 503 });
  }
}
