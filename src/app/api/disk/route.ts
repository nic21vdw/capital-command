import { NextResponse } from "next/server";
import { readDiskUsage } from "@/lib/disk/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readDiskUsage());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read disk usage." },
      { status: 500 }
    );
  }
}
