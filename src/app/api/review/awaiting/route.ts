import { NextResponse } from "next/server";
import { readReviewPolicyState } from "@/lib/publisher/approvalStore";
import { listAwaiting } from "@/lib/publisher/awaiting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { policy, error } = readReviewPolicyState();
  try {
    const items = await listAwaiting(policy);
    return NextResponse.json({ policy, error, total: items.length, items });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : String(reason) }, { status: 500 });
  }
}
