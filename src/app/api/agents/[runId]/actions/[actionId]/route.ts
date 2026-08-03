import { NextRequest, NextResponse } from "next/server";
import { executeAgentAction } from "@/lib/agents/actions";
import { getAgentRun, saveAgentRun } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; actionId: string }> }
) {
  const { runId, actionId } = await params;
  const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  }
  const run = await getAgentRun(runId);
  const action = run?.actions.find((item) => item.id === actionId);
  if (!run || !action) return NextResponse.json({ error: "Unknown agent action." }, { status: 404 });
  if (action.status !== "proposed") return NextResponse.json({ error: "That action was already reviewed." }, { status: 409 });

  if (body.decision === "reject") {
    action.status = "rejected";
    action.result = "Rejected by the user.";
  } else {
    try {
      action.result = await executeAgentAction(action);
      action.status = "approved";
    } catch (error) {
      action.status = "failed";
      action.result = error instanceof Error ? error.message : String(error);
    }
  }
  run.updatedAt = new Date().toISOString();
  await saveAgentRun(run);
  return NextResponse.json({ run });
}
