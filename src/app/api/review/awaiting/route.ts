import { NextResponse } from "next/server";
import { readReviewPolicy } from "@/lib/publisher/approvalStore";
import { listAwaiting } from "@/lib/publisher/awaiting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const policy = readReviewPolicy();
  try {
    const items = await listAwaiting(policy);
    return NextResponse.json({ policy, total: items.length, items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
