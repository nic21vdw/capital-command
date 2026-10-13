import { NextResponse } from "next/server";
import { readBackupStatus } from "@/lib/backup/status-file";
import { dataRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: await readBackupStatus(dataRoot()) }, { headers: { "Cache-Control": "no-store" } });
}
